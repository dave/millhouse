import chalk from 'chalk';
import ora from 'ora';
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

interface RunOptions {
  issue?: string;
  issues?: string;
  concurrency?: string;
  dryRun?: boolean;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const spinner = ora('Initializing Millhouse...').start();

  try {
    // Parse issue numbers
    const issueNumbers = parseIssueNumbers(options);
    if (issueNumbers.length === 0) {
      spinner.fail('No issues specified. Use --issue or --issues');
      process.exit(1);
    }

    const recursive = !!options.issue && !options.issues;
    const concurrency = parseInt(options.concurrency || '3', 10);

    spinner.text = 'Loading configuration...';
    const config = await loadConfig();

    // Initialize components
    spinner.text = 'Connecting to GitHub...';
    const githubClient = new GitHubClient();
    const store = new JsonStore();
    const labelManager = new LabelManager(githubClient);
    const issueDiscoverer = new IssueDiscoverer(githubClient);
    const issueAnalyzer = new IssueAnalyzer();
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();
    const claudeRunner = new ClaudeRunner(config);

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
    });

    spinner.succeed('Initialized');

    // Discover issues
    console.log(chalk.blue('\n📋 Discovering issues...'));
    const issues = await orchestrator.discoverIssues(issueNumbers, recursive);
    console.log(chalk.green(`   Found ${issues.length} issue(s)`));

    // Analyze dependencies
    console.log(chalk.blue('\n🔍 Analyzing dependencies...'));
    const analyzedIssues = await orchestrator.analyzeIssues(issues);

    // Build graph
    console.log(chalk.blue('\n🔗 Building dependency graph...'));
    const graph = graphBuilder.build(analyzedIssues);

    // Show execution plan
    console.log(chalk.blue('\n📊 Execution Plan:'));
    const readyIssues = graph.getReady([]);
    console.log(`   Ready to start: ${readyIssues.map(i => `#${i}`).join(', ')}`);
    console.log(`   Total issues: ${analyzedIssues.length}`);
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
