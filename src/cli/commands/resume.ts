import chalk from 'chalk';
import ora from 'ora';
import { Orchestrator } from '../../core/orchestrator.js';
import { loadConfig } from '../../storage/config.js';
import { JsonStore } from '../../storage/json-store.js';
import { GraphBuilder } from '../../analysis/graph-builder.js';
import { WorktreeManager } from '../../execution/worktree-manager.js';
import { ClaudeRunner } from '../../execution/claude-runner.js';
import { Scheduler } from '../../core/scheduler.js';
import { ProgressDisplay } from '../../cli/progress-display.js';

export async function resumeCommand(runId: string): Promise<void> {
  const spinner = ora('Loading run state...').start();

  try {
    const store = new JsonStore();
    const runState = await store.getRun(runId);

    if (!runState) {
      spinner.fail(`Run not found: ${runId}`);
      process.exit(1);
    }

    if (runState.status === 'completed') {
      spinner.fail('Run already completed');
      process.exit(1);
    }

    spinner.text = 'Loading configuration...';
    const config = await loadConfig();

    // Initialize components
    spinner.text = 'Initializing components...';
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();

    // Create progress display
    const progressDisplay = new ProgressDisplay();

    const claudeRunner = new ClaudeRunner(config, {
      onLog: (issueNumber, message) => {
        progressDisplay.logDetailed(issueNumber, message);
      },
    });

    // Create scheduler with previous concurrency
    const scheduler = new Scheduler({
      concurrency: config.execution.concurrency,
      continueOnError: config.execution.continueOnError,
    });

    // Create orchestrator
    const orchestrator = new Orchestrator({
      config,
      store,
      graphBuilder,
      worktreeManager,
      claudeRunner,
      scheduler,
      progressDisplay,
    });

    spinner.succeed('Loaded');

    // Retry any previously failed jobs
    if (runState.failedIssues.length > 0) {
      console.log(chalk.yellow(`\n🔄 Retrying ${runState.failedIssues.length} failed job(s)...`));

      // Reset failed tasks to queued status
      for (const issueNumber of runState.failedIssues) {
        const task = runState.tasks.find(t => t.issueNumber === issueNumber);
        if (task) {
          task.status = 'queued';
          task.error = undefined;
          task.startedAt = undefined;
          task.completedAt = undefined;
        }
      }

      // Clear failed issues list
      runState.failedIssues = [];
    }

    // Show current state
    console.log(chalk.blue(`\n📦 Resuming run: ${runId}`));
    console.log(`   Completed: ${runState.completedIssues.length}`);
    console.log(`   Failed: ${runState.failedIssues.length}`);
    console.log(`   Remaining: ${runState.issues.length - runState.completedIssues.length - runState.failedIssues.length}`);

    // Resume execution
    console.log(chalk.blue('\n🚀 Resuming execution...'));
    const result = await orchestrator.resume(runState);

    if (result.status === 'completed') {
      console.log(chalk.green('\n✅ All items completed successfully!'));
    } else if (result.status === 'failed') {
      console.log(chalk.red(`\n❌ Run failed: ${result.error}`));
      process.exit(1);
    }
  } catch (error) {
    spinner.fail('Error');
    console.error(chalk.red(`\n${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}
