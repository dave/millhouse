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
    const githubClient = new GitHubClient();
    const labelManager = new LabelManager(githubClient);
    const issueDiscoverer = new IssueDiscoverer(githubClient);
    const issueAnalyzer = new IssueAnalyzer();
    const graphBuilder = new GraphBuilder();
    const worktreeManager = new WorktreeManager();
    const claudeRunner = new ClaudeRunner(config);

    // Create scheduler with previous concurrency
    const scheduler = new Scheduler({
      concurrency: config.execution.concurrency,
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
