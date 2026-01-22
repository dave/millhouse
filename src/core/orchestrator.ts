import chalk from 'chalk';
import type { Config, GitHubIssue, AnalyzedIssue, RunState, Task } from '../types.js';
import type { JsonStore } from '../storage/json-store.js';
import type { GitHubClient } from '../github/client.js';
import type { LabelManager } from '../github/label-manager.js';
import type { IssueDiscoverer } from '../github/issue-discoverer.js';
import type { IssueAnalyzer } from '../analysis/issue-analyzer.js';
import type { GraphBuilder, DependencyGraph } from '../analysis/graph-builder.js';
import type { WorktreeManager } from '../execution/worktree-manager.js';
import type { ClaudeRunner } from '../execution/claude-runner.js';
import type { Scheduler } from './scheduler.js';

interface OrchestratorOptions {
  config: Config;
  store: JsonStore;
  githubClient: GitHubClient;
  labelManager: LabelManager;
  issueDiscoverer: IssueDiscoverer;
  issueAnalyzer: IssueAnalyzer;
  graphBuilder: GraphBuilder;
  worktreeManager: WorktreeManager;
  claudeRunner: ClaudeRunner;
  scheduler: Scheduler;
}

export class Orchestrator {
  private config: Config;
  private store: JsonStore;
  private githubClient: GitHubClient;
  private labelManager: LabelManager;
  private issueDiscoverer: IssueDiscoverer;
  private issueAnalyzer: IssueAnalyzer;
  private graphBuilder: GraphBuilder;
  private worktreeManager: WorktreeManager;
  private claudeRunner: ClaudeRunner;
  private scheduler: Scheduler;

  private runState: RunState | null = null;
  private graph: DependencyGraph | null = null;
  private isShuttingDown = false;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.store = options.store;
    this.githubClient = options.githubClient;
    this.labelManager = options.labelManager;
    this.issueDiscoverer = options.issueDiscoverer;
    this.issueAnalyzer = options.issueAnalyzer;
    this.graphBuilder = options.graphBuilder;
    this.worktreeManager = options.worktreeManager;
    this.claudeRunner = options.claudeRunner;
    this.scheduler = options.scheduler;

    // Handle graceful shutdown
    this.setupShutdownHandlers();
  }

  private setupShutdownHandlers(): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      console.log(chalk.yellow('\n\n⚠️  Graceful shutdown initiated...'));

      if (this.runState) {
        this.runState.status = 'interrupted';
        this.runState.updatedAt = new Date().toISOString();
        await this.store.saveRun(this.runState);
        console.log(chalk.yellow(`   Run saved. Resume with: millhouse resume ${this.runState.id}`));
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Discover all issues starting from the given issue numbers.
   */
  async discoverIssues(issueNumbers: number[], recursive: boolean): Promise<GitHubIssue[]> {
    return this.issueDiscoverer.discover(issueNumbers, recursive);
  }

  /**
   * Analyze issues for dependencies.
   */
  async analyzeIssues(issues: GitHubIssue[]): Promise<AnalyzedIssue[]> {
    return this.issueAnalyzer.analyzeIssues(issues);
  }

  /**
   * Run the full orchestration pipeline.
   */
  async run(analyzedIssues: AnalyzedIssue[]): Promise<RunState> {
    // Create run state
    const runId = this.store.generateRunId();
    const baseBranch = this.config.execution.baseBranch;

    // Build dependency graph
    this.graph = this.graphBuilder.build(analyzedIssues);

    // Check for cycles
    if (!this.graph.isAcyclic()) {
      const cycles = this.graph.getCycles();
      throw new Error(
        `Circular dependencies detected: ${cycles.map(c => c.map(n => `#${n}`).join(' → ')).join('; ')}`
      );
    }

    // Create run branch
    console.log(chalk.blue(`   Creating run branch: millhouse/run-${runId}`));
    const runBranch = await this.worktreeManager.createRunBranch(runId, baseBranch);

    // Initialize run state
    this.runState = {
      id: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      baseBranch,
      runBranch,
      issues: analyzedIssues,
      tasks: analyzedIssues.map(issue => ({
        issueNumber: issue.number,
        status: 'queued',
      })),
      completedIssues: [],
      failedIssues: [],
    };

    await this.store.saveRun(this.runState);

    // Ensure labels exist
    await this.labelManager.ensureLabelsExist();

    // Mark all issues as queued
    await this.labelManager.setStatusBatch(
      analyzedIssues.map(i => i.number),
      'queued'
    );

    // Run the scheduler
    return this.executeScheduler(runId, runBranch, analyzedIssues);
  }

  /**
   * Resume an interrupted run.
   */
  async resume(runState: RunState): Promise<RunState> {
    this.runState = runState;

    // Rebuild graph from issues
    this.graph = this.graphBuilder.build(runState.issues);

    // Update status
    this.runState.status = 'running';
    this.runState.updatedAt = new Date().toISOString();
    await this.store.saveRun(this.runState);

    // Continue from where we left off
    return this.executeScheduler(
      runState.id,
      runState.runBranch,
      runState.issues
    );
  }

  /**
   * Execute the scheduler loop.
   */
  private async executeScheduler(
    runId: string,
    runBranch: string,
    issues: AnalyzedIssue[]
  ): Promise<RunState> {
    if (!this.runState || !this.graph) {
      throw new Error('Run state not initialized');
    }

    const issueMap = new Map(issues.map(i => [i.number, i]));

    // Initialize scheduler
    this.scheduler.initialize(
      this.graph,
      this.runState.completedIssues,
      this.runState.failedIssues
    );

    // Set up event handlers
    this.scheduler.on('event', async (event) => {
      await this.handleSchedulerEvent(event, runId, runBranch);
    });

    // Create task executor
    const executor = async (issueNumber: number) => {
      const issue = issueMap.get(issueNumber);
      if (!issue) {
        return { success: false, commits: [], error: 'Issue not found' };
      }

      try {
        // Create worktree
        console.log(chalk.blue(`   Creating worktree for #${issueNumber}...`));
        const worktree = await this.worktreeManager.createWorktree(
          runId,
          issueNumber,
          runBranch
        );
        await this.store.saveWorktree(worktree);

        // Run Claude
        console.log(chalk.blue(`   Running Claude for #${issueNumber}...`));
        const result = await this.claudeRunner.run(issue, runId, worktree.path);

        if (result.success) {
          // Merge changes back
          console.log(chalk.blue(`   Merging changes for #${issueNumber}...`));
          const mergeResult = await this.worktreeManager.mergeWorktree(
            worktree.path,
            runBranch
          );

          if (!mergeResult.success) {
            return {
              success: false,
              commits: result.commits,
              error: mergeResult.error || 'Merge failed',
            };
          }
        }

        // Clean up worktree
        await this.worktreeManager.removeWorktree(worktree.path);
        await this.store.removeWorktree(worktree.path);

        return result;
      } catch (error) {
        return {
          success: false,
          commits: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    // Run scheduler
    const { completed, failed } = await this.scheduler.run(executor);

    // Update final state
    this.runState.completedIssues = completed;
    this.runState.failedIssues = failed;
    this.runState.updatedAt = new Date().toISOString();

    // Create PR if all completed
    if (failed.length === 0 && completed.length > 0) {
      try {
        // Push run branch
        console.log(chalk.blue('   Pushing changes...'));
        await this.worktreeManager.pushRunBranch(runBranch);

        // Create PR
        console.log(chalk.blue('   Creating pull request...'));
        const prUrl = await this.createFinalPR(runId, runBranch, issues, completed);
        this.runState.pullRequestUrl = prUrl;
        this.runState.status = 'completed';
      } catch (error) {
        this.runState.error = error instanceof Error ? error.message : String(error);
        this.runState.status = 'failed';
      }
    } else if (failed.length > 0) {
      this.runState.status = 'failed';
      this.runState.error = `${failed.length} issue(s) failed`;
    } else {
      this.runState.status = 'completed';
    }

    await this.store.saveRun(this.runState);
    return this.runState;
  }

  /**
   * Handle scheduler events.
   */
  private async handleSchedulerEvent(
    event: { type: string; issueNumber?: number; commits?: string[]; error?: string; issueNumbers?: number[] },
    _runId: string,
    _runBranch: string
  ): Promise<void> {
    if (!this.runState) return;

    switch (event.type) {
      case 'task-started':
        console.log(chalk.cyan(`   ▶ Started: #${event.issueNumber}`));
        await this.labelManager.markInProgress(event.issueNumber!);
        this.updateTaskStatus(event.issueNumber!, 'in-progress');
        break;

      case 'task-completed':
        console.log(chalk.green(`   ✓ Completed: #${event.issueNumber}`));
        await this.labelManager.markDone(event.issueNumber!);
        this.updateTaskStatus(event.issueNumber!, 'completed', event.commits);
        break;

      case 'task-failed':
        console.log(chalk.red(`   ✗ Failed: #${event.issueNumber} - ${event.error}`));
        await this.labelManager.markFailed(event.issueNumber!);
        await this.githubClient.addComment(
          event.issueNumber!,
          `❌ Millhouse failed to implement this issue:\n\n\`\`\`\n${event.error}\n\`\`\``
        );
        this.updateTaskStatus(event.issueNumber!, 'failed', undefined, event.error);
        break;

      case 'tasks-unblocked':
        console.log(chalk.cyan(`   ⏳ Unblocked: ${event.issueNumbers!.map(n => `#${n}`).join(', ')}`));
        for (const num of event.issueNumbers!) {
          this.updateTaskStatus(num, 'ready');
        }
        break;
    }

    // Save state after each event
    this.runState.updatedAt = new Date().toISOString();
    await this.store.saveRun(this.runState);
  }

  /**
   * Update a task's status in the run state.
   */
  private updateTaskStatus(
    issueNumber: number,
    status: Task['status'],
    commits?: string[],
    error?: string
  ): void {
    if (!this.runState) return;

    const task = this.runState.tasks.find(t => t.issueNumber === issueNumber);
    if (task) {
      task.status = status;
      if (status === 'in-progress') {
        task.startedAt = new Date().toISOString();
      }
      if (status === 'completed' || status === 'failed') {
        task.completedAt = new Date().toISOString();
      }
      if (commits) {
        task.commits = commits;
      }
      if (error) {
        task.error = error;
      }
    }
  }

  /**
   * Create the final pull request.
   */
  private async createFinalPR(
    runId: string,
    runBranch: string,
    issues: AnalyzedIssue[],
    completedIssues: number[]
  ): Promise<string> {
    const completedSet = new Set(completedIssues);
    const completed = issues.filter(i => completedSet.has(i.number));

    const title = completed.length === 1
      ? `Fix #${completed[0].number}: ${completed[0].title}`
      : `Millhouse: Implement ${completed.length} issues`;

    const issueList = completed
      .map(i => `- Fixes #${i.number}: ${i.title}`)
      .join('\n');

    const body = `## Summary

This PR implements the following issues:

${issueList}

## Details

Run ID: \`${runId}\`
Branch: \`${runBranch}\`

---
🤖 Generated by [Millhouse](https://github.com/dave/millhouse)`;

    return this.githubClient.createPullRequest({
      title,
      body,
      head: runBranch,
      base: this.config.execution.baseBranch,
      draft: this.config.pullRequests.createAsDraft,
    });
  }
}
