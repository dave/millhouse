import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import path from 'node:path';
import { promises as fs } from 'node:fs';
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
import type { AnalyzedIssue, JsonPlan } from '../../types.js';

interface RunOptions {
  concurrency?: string;
  display?: 'compact' | 'detailed';
  dryRun?: boolean;
  scan?: boolean;
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

async function checkLeftoverState(): Promise<boolean> {
  const leftoverState = await detectLeftoverState();

  if (leftoverState.hasLeftovers) {
    displayLeftoverState(leftoverState);

    let prompt = 'What would you like to do?\n';
    if (leftoverState.interruptedRuns.length > 0) {
      prompt += '  [r] Resume the most recent interrupted run\n';
    }
    prompt += '  [c] Clean up and start fresh\n';
    prompt += '  [q] Quit\n';
    prompt += 'Choice: ';

    const choice = await promptUser(prompt);

    if (choice === 'r' && leftoverState.interruptedRuns.length > 0) {
      const mostRecent = leftoverState.interruptedRuns.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )[0];
      console.log(chalk.blue(`\nResuming run: ${mostRecent.id}\n`));
      await resumeCommand(mostRecent.id);
      return false; // Don't continue with new run
    } else if (choice === 'c') {
      const spinner = ora('Cleaning up...').start();
      await cleanupAllState();
      spinner.succeed('Cleaned up previous state');
      console.log('');
      return true; // Continue with new run
    } else {
      console.log(chalk.gray('Exiting.'));
      process.exit(0);
    }
  }

  return true; // No leftovers, continue
}

/**
 * Get the JSON plan filename for a given name.
 * No name = millhouse-plan.json
 * With name = millhouse-plan-{name}.json
 */
function getJsonPlanFilename(name?: string): string {
  return name ? `millhouse-plan-${name}.json` : 'millhouse-plan.json';
}

/**
 * Try to load a JSON plan file.
 * Returns null if not found.
 */
async function loadJsonPlan(name?: string): Promise<JsonPlan | null> {
  const filename = getJsonPlanFilename(name);
  const filepath = path.join(process.cwd(), filename);

  try {
    const content = await fs.readFile(filepath, 'utf-8');
    const plan = JSON.parse(content) as JsonPlan;

    // Validate version
    if (plan.version !== 1) {
      console.log(chalk.yellow(`   Warning: JSON plan version ${plan.version} may not be compatible`));
    }

    return plan;
  } catch {
    return null;
  }
}

/**
 * Convert a JSON plan to AnalyzedIssue array for execution.
 */
function jsonPlanToAnalyzedIssues(plan: JsonPlan): AnalyzedIssue[] {
  return plan.items.map(item => ({
    number: item.id,
    title: item.title,
    body: item.body,
    state: 'open' as const,
    labels: [],
    url: '',
    htmlUrl: '',
    affectedPaths: [],
    dependencies: item.dependencies,
    analyzedAt: plan.createdAt,
  }));
}

// Plan mode: millhouse run [plan-name]
// If plan-name is given, first looks for millhouse-plan-{name}.json
// If no name given, looks for millhouse-plan.json
// Falls back to markdown plan analysis if JSON not found
export async function runPlanCommand(plan: string | undefined, options: RunOptions): Promise<void> {
  const shouldContinue = await checkLeftoverState();
  if (!shouldContinue) return;

  const spinner = ora('Initializing Millhouse (plan mode)...').start();

  try {
    const concurrency = parseInt(options.concurrency || '8', 10);

    // Load JSON plan
    spinner.text = 'Loading JSON plan...';
    const jsonPlan = await loadJsonPlan(plan);

    if (!jsonPlan) {
      const filename = getJsonPlanFilename(plan);
      spinner.fail(`JSON plan not found: ${filename}`);
      console.log(chalk.gray(`\n   Run /millhouse plan in Claude Code to create the JSON plan first.`));
      process.exit(1);
    }

    spinner.succeed(`Loaded ${jsonPlan.items.length} work item(s) from ${getJsonPlanFilename(plan)}`);
    const analyzedIssues = jsonPlanToAnalyzedIssues(jsonPlan);

    // Load config
    const config = await loadConfig();

    // Initialize components (no GitHub needed)
    const store = new JsonStore();
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();
    const progressDisplay = new ProgressDisplay({ displayMode: options.display });

    const claudeRunner = new ClaudeRunner(config, {
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      onLog: (issueNumber, message) => {
        progressDisplay.logDetailed(issueNumber, message);
      },
    });

    const scheduler = new Scheduler({
      concurrency,
      continueOnError: config.execution.continueOnError,
    });

    // Create orchestrator without GitHub components
    const orchestrator = new Orchestrator({
      config,
      store,
      graphBuilder,
      worktreeManager,
      claudeRunner,
      scheduler,
      progressDisplay,
      scanProject: options.scan !== false && !options.dryRun,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
    });

    // Build graph
    console.log(chalk.blue('\n🔗 Building dependency graph...'));
    const graph = graphBuilder.build(analyzedIssues);
    console.log(chalk.green(`   ✓ Graph built`));

    // Show execution plan
    console.log(chalk.blue('\n📊 Execution Plan:'));
    const readyIssues = graph.getReady([]);
    const blockedCount = analyzedIssues.length - readyIssues.length;
    console.log(`   Total items: ${analyzedIssues.length}`);
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
      console.log(chalk.green('\n✅ All items completed successfully!'));
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

// GitHub issues mode: millhouse run issues [numbers]
export async function runIssuesCommand(numbers: string | undefined, options: RunOptions): Promise<void> {
  const shouldContinue = await checkLeftoverState();
  if (!shouldContinue) return;

  const spinner = ora('Initializing Millhouse (GitHub issues mode)...').start();

  try {
    const concurrency = parseInt(options.concurrency || '8', 10);

    spinner.text = 'Loading configuration...';
    const config = await loadConfig();

    // Initialize components
    spinner.text = 'Connecting to GitHub...';
    const githubClient = new GitHubClient();

    // Parse issue numbers or fetch all open issues
    let issueNumbers: number[] = [];

    if (numbers) {
      issueNumbers = numbers.split(',').map(s => parseInt(s.trim(), 10));
    }

    if (issueNumbers.length === 0) {
      spinner.text = 'Fetching all open issues...';
      const openIssues = await githubClient.listOpenIssues();
      issueNumbers = openIssues.map(i => i.number);

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
    const progressDisplay = new ProgressDisplay({ displayMode: options.display });

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
      scanProject: options.scan !== false && !options.dryRun,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
    });

    // Discover issues (always recursive to find linked issues)
    console.log(chalk.blue('\n📋 Discovering issues...'));
    const issues = await orchestrator.discoverIssues(issueNumbers, true);
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
