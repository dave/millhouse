import chalk from 'chalk';
import ora from 'ora';
import { Orchestrator } from '../../core/orchestrator.js';
import { loadConfig } from '../../storage/config.js';
import { JsonStore } from '../../storage/json-store.js';
import { GitHubClient } from '../../github/client.js';
import { LabelManager } from '../../github/label-manager.js';
import { IssueDiscoverer } from '../../github/issue-discoverer.js';
import { IssueAnalyzer } from '../../analysis/issue-analyzer.js';
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

    // Only initialize GitHub components for GitHub mode runs
    const isGitHubMode = runState.mode === 'github';
    const githubClient = isGitHubMode ? new GitHubClient() : undefined;
    const labelManager = isGitHubMode && githubClient ? new LabelManager(githubClient) : undefined;
    const issueDiscoverer = isGitHubMode && githubClient ? new IssueDiscoverer(githubClient) : undefined;
    const issueAnalyzer = isGitHubMode ? new IssueAnalyzer() : undefined;

    // Create orchestrator
    const orchestrator = new Orchestrator({
      config,
      store,
      graphBuilder,
      worktreeManager,
      claudeRunner,
      scheduler,
      progressDisplay,
      ...(isGitHubMode && {
        githubClient,
        labelManager,
        issueDiscoverer,
        issueAnalyzer,
      }),
    });

    spinner.succeed('Loaded');

    // Show current state
    console.log(chalk.blue(`\n📦 Resuming run: ${runId}`));
    console.log(`   Completed: ${runState.completedIssues.length}`);
    console.log(`   Failed: ${runState.failedIssues.length}`);
    console.log(`   Remaining: ${runState.issues.length - runState.completedIssues.length - runState.failedIssues.length}`);

    // Resume execution
    console.log(chalk.blue('\n🚀 Resuming execution...'));
    const result = await orchestrator.resume(runState);

    if (result.status === 'completed') {
      console.log(chalk.green('\n✅ All issues completed successfully!'));
      if (result.pullRequestUrl) {
        console.log(chalk.blue(`   Pull request: ${result.pullRequestUrl}`));
      }
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
