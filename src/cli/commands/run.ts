import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { Orchestrator } from '../../core/orchestrator.js';
import { loadConfig } from '../../storage/config.js';
import { JsonStore } from '../../storage/json-store.js';
import { GitHubClient } from '../../github/client.js';
import { IssueDiscoverer } from '../../github/issue-discoverer.js';
import { LabelManager } from '../../github/label-manager.js';
import { IssueAnalyzer } from '../../analysis/issue-analyzer.js';
import { PlanParser } from '../../analysis/plan-parser.js';
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
  concurrency?: string;
  display?: 'compact' | 'detailed';
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

async function findProjectPlans(): Promise<string[]> {
  // Convert cwd to Claude project path format: /Users/dave/src/foo -> -Users-dave-src-foo
  const cwd = process.cwd();
  const projectDirName = cwd.replace(/\//g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectDirName);

  const planRefs = new Set<string>();

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    // Search transcript files for plan references
    for (const file of jsonlFiles) {
      try {
        const content = await fs.readFile(path.join(projectDir, file), 'utf-8');
        // Match plan file paths like .claude/plans/name.md or ~/.claude/plans/name.md
        const matches = content.match(/\.claude\/plans\/[a-z-]+\.md/g);
        if (matches) {
          for (const match of matches) {
            // Extract just the filename
            const filename = match.split('/').pop();
            if (filename && !filename.includes('-agent-')) {
              // Skip agent subplans
              planRefs.add(filename);
            }
          }
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Project directory doesn't exist
  }

  return Array.from(planRefs);
}

async function findMostRecentPlan(): Promise<string | null> {
  const plansDir = path.join(os.homedir(), '.claude', 'plans');

  // First, get plans associated with this project
  const projectPlans = await findProjectPlans();

  try {
    const files = await fs.readdir(plansDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      return null;
    }

    // Filter to only project-specific plans if we found any
    const relevantFiles = projectPlans.length > 0
      ? mdFiles.filter(f => projectPlans.includes(f))
      : mdFiles;

    if (relevantFiles.length === 0) {
      return null;
    }

    const fileStats = await Promise.all(
      relevantFiles.map(async (f) => {
        const fullPath = path.join(plansDir, f);
        const stat = await fs.stat(fullPath);
        return { path: fullPath, mtime: stat.mtime };
      })
    );

    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return fileStats[0].path;
  } catch {
    return null;
  }
}

async function resolvePlanPath(planPath: string | undefined): Promise<string> {
  // If no plan specified, find most recent plan
  if (!planPath) {
    const recentPlan = await findMostRecentPlan();
    if (!recentPlan) {
      throw new Error('No plan files found in ~/.claude/plans/');
    }
    return recentPlan;
  }

  // First, try the path as given
  try {
    await fs.access(planPath);
    return planPath;
  } catch {
    // Not found locally
  }

  // If it's just a filename (no directory), check ~/.claude/plans/
  if (!planPath.includes(path.sep) && !planPath.startsWith('.')) {
    const claudePlansPath = path.join(os.homedir(), '.claude', 'plans', planPath);
    try {
      await fs.access(claudePlansPath);
      return claudePlansPath;
    } catch {
      // Not found there either
    }
  }

  // Return original path - will fail with helpful error
  return planPath;
}

// Plan mode: millhouse run [plan-file]
export async function runPlanCommand(plan: string | undefined, options: RunOptions): Promise<void> {
  const shouldContinue = await checkLeftoverState();
  if (!shouldContinue) return;

  const spinner = ora('Initializing Millhouse (plan mode)...').start();

  try {
    const concurrency = parseInt(options.concurrency || '8', 10);

    // Load plan from file (check ~/.claude/plans/ if not found locally)
    spinner.text = 'Loading plan...';
    const planPath = await resolvePlanPath(plan);
    const planContent = await fs.readFile(planPath, 'utf-8');
    spinner.succeed(`Loaded plan from ${planPath}`);

    // Parse plan into work items
    console.log(chalk.blue('\n🔍 Analyzing plan...'));
    const planParser = new PlanParser();
    const analyzedIssues = await planParser.parse(planContent);
    console.log(chalk.green(`   ✓ Created ${analyzedIssues.length} work item(s)`));

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
