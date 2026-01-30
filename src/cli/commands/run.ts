import chalk from 'chalk';
import ora from 'ora';
import readline from 'node:readline';
import { Orchestrator } from '../../core/orchestrator.js';
import { JsonStore } from '../../storage/json-store.js';
import { WorklistStore } from '../../storage/worklist-store.js';
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
import type { AnalyzedIssue } from '../../types.js';

interface RunOptions {
  concurrency?: string;
  display?: 'compact' | 'detailed';
  dryRun?: boolean;
  dangerouslySkipPermissions?: boolean;
  continueOnError?: boolean;
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

export async function runCommand(options: RunOptions): Promise<void> {
  const shouldContinue = await checkLeftoverState();
  if (!shouldContinue) return;

  const spinner = ora('Initializing...').start();

  try {
    const concurrency = parseInt(options.concurrency || '8', 10);

    // Load worklist
    spinner.text = 'Loading worklist...';
    const worklistStore = new WorklistStore();
    const worklist = await worklistStore.load();

    if (!worklist) {
      spinner.fail('No worklist found');
      console.log(chalk.gray('\n   Run "millhouse init" or "millhouse load" first.'));
      process.exit(1);
    }

    // Filter to pending items
    const pendingItems = worklist.items.filter(i => i.status === 'pending');

    if (pendingItems.length === 0) {
      spinner.succeed('All items already completed!');
      return;
    }

    spinner.succeed(`Loaded ${pendingItems.length} pending item(s) from worklist`);

    // Convert to AnalyzedIssue format for orchestrator compatibility
    const analyzedIssues: AnalyzedIssue[] = pendingItems.map(item => ({
      number: item.id,
      title: item.title,
      body: item.body,
      state: 'open' as const,
      labels: [],
      url: '',
      htmlUrl: '',
      affectedPaths: [],
      dependencies: item.dependencies,
      analyzedAt: worklist.createdAt,
      // Pass through GitHub issue number for commit messages
      githubIssueNumber: item.githubIssueNumber,
    }));

    // Initialize components
    const store = new JsonStore();
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();
    const progressDisplay = new ProgressDisplay({ displayMode: options.display });

    const claudeRunner = new ClaudeRunner({
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      onLog: (issueNumber, message) => {
        progressDisplay.logDetailed(issueNumber, message);
      },
    });

    const scheduler = new Scheduler({
      concurrency,
      continueOnError: options.continueOnError ?? true,
    });

    // Create orchestrator
    const orchestrator = new Orchestrator({
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

    // Update worklist based on results
    for (const completedId of result.completedIssues) {
      await worklistStore.markCompleted(completedId);
    }
    for (const failedId of result.failedIssues) {
      const task = result.tasks.find(t => t.issueNumber === failedId);
      await worklistStore.markFailed(failedId, task?.error || 'Unknown error');
    }

    if (result.status === 'completed') {
      console.log(chalk.green('\n✅ All items completed successfully!'));
    } else if (result.status === 'failed') {
      console.log(chalk.red(`\n❌ Run failed: ${result.error}`));
      console.log(`   Completed: ${result.completedIssues.length}`);
      console.log(`   Failed: ${result.failedIssues.length}`);
      for (const failedId of result.failedIssues) {
        const task = result.tasks.find(t => t.issueNumber === failedId);
        const issue = analyzedIssues.find(i => i.number === failedId);
        const title = issue?.title || `Issue #${failedId}`;
        console.log(chalk.red(`\n   #${failedId} ${title}`));
        if (task?.error) {
          console.log(chalk.gray(`   Error: ${task.error}`));
        }
      }
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Error');
    console.error(chalk.red(`\n${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}
