import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import { Orchestrator } from '../../core/orchestrator.js';
import { loadConfig } from '../../storage/config.js';
import { JsonStore } from '../../storage/json-store.js';
import { GitHubClient } from '../../github/client.js';
import { IssueDiscoverer } from '../../github/issue-discoverer.js';
import { LabelManager } from '../../github/label-manager.js';
import { IssueAnalyzer } from '../../analysis/issue-analyzer.js';
import { GraphBuilder } from '../../analysis/graph-builder.js';
import { WorktreeManager } from '../../execution/worktree-manager.js';
import { ClaudeRunner } from '../../execution/claude-runner.js';
import { Scheduler } from '../../core/scheduler.js';
import {
  detectLeftoverState,
  cleanupAllState,
  displayLeftoverState,
} from '../cleanup.js';
import { resumeCommand } from './resume.js';
import { ProgressDisplay } from '../progress-display.js';

interface RunOptions {
  issue?: string;
  issues?: string;
  concurrency?: string;
  dryRun?: boolean;
  dangerouslySkipPermissions?: boolean;
}

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

export async function runCommand(options: RunOptions): Promise<void> {
  // Check for leftover state from previous runs
  const leftoverState = await detectLeftoverState();

  if (leftoverState.hasLeftovers) {
    displayLeftoverState(leftoverState);

    // Build prompt based on what we found
    let prompt = 'What would you like to do?\n';
    if (leftoverState.interruptedRuns.length > 0) {
      prompt += '  [r] Resume the most recent interrupted run\n';
    }
    prompt += '  [c] Clean up and start fresh\n';
    prompt += '  [q] Quit\n';
    prompt += 'Choice: ';

    const choice = await promptUser(prompt);

    if (choice === 'r' && leftoverState.interruptedRuns.length > 0) {
      // Resume the most recent interrupted run
      const mostRecent = leftoverState.interruptedRuns.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
      console.log(chalk.blue(`\nResuming run: ${mostRecent.id}\n`));
      await resumeCommand(mostRecent.id);
      return;
    } else if (choice === 'c') {
      const spinner = ora('Cleaning up...').start();
      await cleanupAllState();
      spinner.succeed('Cleaned up previous state');
      console.log('');
    } else {
      console.log(chalk.gray('Exiting.'));
      process.exit(0);
    }
  }

  const spinner = ora('Initializing Millhouse...').start();

  try {
    const concurrency = parseInt(options.concurrency || '8', 10);

    spinner.text = 'Loading configuration...';
    const config = await loadConfig();

    // Initialize components
    spinner.text = 'Connecting to GitHub...';
    const githubClient = new GitHubClient();

    // Parse issue numbers or fetch all open issues
    let issueNumbers = parseIssueNumbers(options);
    let recursive = !!options.issue && !options.issues;

    if (issueNumbers.length === 0) {
      spinner.text = 'Fetching all open issues...';
      const openIssues = await githubClient.listOpenIssues();
      issueNumbers = openIssues.map(i => i.number);
      recursive = false; // Already have all issues

      if (issueNumbers.length === 0) {
        spinner.fail('No open issues found in this repository');
        process.exit(1);
      }
      spinner.succeed(`Found ${issueNumbers.length} open issue(s)`);
    } else {
      spinner.succeed('Initialized');
    }
    const store = new JsonStore();
    const labelManager = new LabelManager(githubClient);
    const issueDiscoverer = new IssueDiscoverer(githubClient);
    const issueAnalyzer = new IssueAnalyzer();
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();

    // Create progress display
    const progressDisplay = new ProgressDisplay();

    const claudeRunner = new ClaudeRunner(config, {
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      onLog: (issueNumber, message) => {
        progressDisplay.logDetailed(issueNumber, message);
      },
    });

    // Create scheduler
    const scheduler = new Scheduler({
      concurrency,
      continueOnError: config.execution.continueOnError,
    });

    // Create orchestrator
    const orchestrator = new Orchestrator({
      config,
      store,
      githubClient,
      labelManager,
      issueDiscoverer,
      issueAnalyzer,
      graphBuilder,
      worktreeManager,
      claudeRunner,
      scheduler,
      progressDisplay,
    });

    spinner.succeed('Initialized');

    // Discover issues
    console.log(chalk.blue('\n📋 Discovering issues...'));
    const issues = await orchestrator.discoverIssues(issueNumbers, recursive);
    console.log(chalk.green(`   ✓ Found ${issues.length} issue(s)`));

    // Analyze dependencies
    console.log(chalk.blue('\n🔍 Analyzing dependencies...'));
    const analyzedIssues = await orchestrator.analyzeIssues(issues);
    console.log(chalk.green(`   ✓ Analysis complete`));

    // Build graph
    console.log(chalk.blue('\n🔗 Building dependency graph...'));
    const graph = graphBuilder.build(analyzedIssues);
    console.log(chalk.green(`   ✓ Graph built`));

    // Show execution plan
    console.log(chalk.blue('\n📊 Execution Plan:'));
    const readyIssues = graph.getReady([]);
    const blockedCount = analyzedIssues.length - readyIssues.length;
    console.log(`   Total issues: ${analyzedIssues.length}`);
    console.log(`   Ready to start: ${readyIssues.length} (${readyIssues.map(i => `#${i}`).join(', ')})`);
    console.log(`   Blocked by dependencies: ${blockedCount}`);
    console.log(`   Concurrency: ${concurrency}`);

    if (options.dryRun) {
      console.log(chalk.yellow('\n🔍 Dry run complete. No changes made.'));
      return;
    }

    // Run orchestration
    console.log(chalk.blue('\n🚀 Starting execution...'));
    const result = await orchestrator.run(analyzedIssues);

    if (result.status === 'completed') {
      console.log(chalk.green('\n✅ All issues completed successfully!'));
      if (result.pullRequestUrl) {
        console.log(chalk.blue(`   Pull request: ${result.pullRequestUrl}`));
      }
    } else if (result.status === 'failed') {
      console.log(chalk.red(`\n❌ Run failed: ${result.error}`));
      console.log(`   Completed: ${result.completedIssues.length}`);
      console.log(`   Failed: ${result.failedIssues.length}`);
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Error');
    console.error(chalk.red(`\n${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function parseIssueNumbers(options: RunOptions): number[] {
  if (options.issue) {
    return [parseInt(options.issue, 10)];
  }
  if (options.issues) {
    return options.issues.split(',').map(s => parseInt(s.trim(), 10));
  }
  return [];
}
