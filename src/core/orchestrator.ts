import chalk from 'chalk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
import type { ProgressDisplay } from '../cli/progress-display.js';
import { scanProject } from '../execution/project-scanner.js';

interface OrchestratorOptions {
  config: Config;
  store: JsonStore;
  graphBuilder: GraphBuilder;
  worktreeManager: WorktreeManager;
  claudeRunner: ClaudeRunner;
  scheduler: Scheduler;
  // GitHub-specific (optional for local mode)
  githubClient?: GitHubClient;
  labelManager?: LabelManager;
  issueDiscoverer?: IssueDiscoverer;
  issueAnalyzer?: IssueAnalyzer;
  progressDisplay?: ProgressDisplay;
  // Project scanning options
  scanProject?: boolean;
  dangerouslySkipPermissions?: boolean;
}

export class Orchestrator {
  private config: Config;
  private store: JsonStore;
  private graphBuilder: GraphBuilder;
  private worktreeManager: WorktreeManager;
  private claudeRunner: ClaudeRunner;
  private scheduler: Scheduler;
  // GitHub-specific (optional for local mode)
  private githubClient?: GitHubClient;
  private labelManager?: LabelManager;
  private issueDiscoverer?: IssueDiscoverer;
  private issueAnalyzer?: IssueAnalyzer;
  private progressDisplay?: ProgressDisplay;

  private runState: RunState | null = null;
  private graph: DependencyGraph | null = null;
  private isShuttingDown = false;
  private originalBranch: string | null = null;
  private shouldScanProject: boolean;
  private dangerouslySkipPermissions: boolean;

  constructor(options: OrchestratorOptions) {
    this.config = options.config;
    this.store = options.store;
    this.graphBuilder = options.graphBuilder;
    this.worktreeManager = options.worktreeManager;
    this.claudeRunner = options.claudeRunner;
    this.scheduler = options.scheduler;
    // GitHub-specific
    this.githubClient = options.githubClient;
    this.labelManager = options.labelManager;
    this.issueDiscoverer = options.issueDiscoverer;
    this.issueAnalyzer = options.issueAnalyzer;
    this.progressDisplay = options.progressDisplay;
    // Project scanning
    this.shouldScanProject = options.scanProject ?? true;
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? false;

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

      // Restore original branch
      if (this.originalBranch) {
        console.log(chalk.yellow(`   Restoring branch: ${this.originalBranch}`));
        await this.worktreeManager.restoreBranch(this.originalBranch);
      }

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  /**
   * Discover all issues starting from the given issue numbers.
   * Only available in GitHub mode.
   */
  async discoverIssues(issueNumbers: number[], recursive: boolean): Promise<GitHubIssue[]> {
    if (!this.issueDiscoverer) {
      throw new Error('discoverIssues is only available in GitHub mode');
    }
    return this.issueDiscoverer.discover(issueNumbers, recursive);
  }

  /**
   * Analyze issues for dependencies.
   * Only available in GitHub mode.
   */
  async analyzeIssues(issues: GitHubIssue[]): Promise<AnalyzedIssue[]> {
    if (!this.issueAnalyzer) {
      throw new Error('analyzeIssues is only available in GitHub mode');
    }
    return this.issueAnalyzer.analyzeIssues(issues);
  }

  /**
   * Run the full orchestration pipeline.
   */
  async run(analyzedIssues: AnalyzedIssue[]): Promise<RunState> {
    // Save original branch to restore later
    this.originalBranch = await this.worktreeManager.getCurrentBranch();

    // Check for existing CLAUDE.md or run /init
    if (this.shouldScanProject) {
      const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
      try {
        await fs.access(claudeMdPath);
        // CLAUDE.md exists - workers will pick it up automatically from worktree
        console.log(chalk.blue('\n📂 Using existing CLAUDE.md for project context'));
      } catch {
        // No CLAUDE.md - run /init to create one
        console.log(chalk.blue('\n📂 No CLAUDE.md found, running /init...'));
        const scanResult = await scanProject(process.cwd(), {
          dangerouslySkipPermissions: this.dangerouslySkipPermissions,
          onLog: (message) => {
            console.log(chalk.gray(`   ${message}`));
          },
        });

        if (scanResult.success) {
          console.log(chalk.green('   ✓ CLAUDE.md created'));
        } else {
          console.log(chalk.yellow(`   ⚠ /init failed: ${scanResult.error}`));
          // Continue without - it's not critical
        }
      }
    }

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

    // GitHub-specific: manage labels
    if (this.labelManager) {
      await this.labelManager.ensureLabelsExist();
      await this.labelManager.setStatusBatch(
        analyzedIssues.map(i => i.number),
        'queued'
      );
    }

    // Initialize progress display
    if (this.progressDisplay) {
      this.progressDisplay.initialize(analyzedIssues);
      this.progressDisplay.start();
    }

    // Run the scheduler
    try {
      return await this.executeScheduler(runId, runBranch, analyzedIssues);
    } finally {
      if (this.progressDisplay) {
        this.progressDisplay.stop();
      }
      // Restore original branch
      if (this.originalBranch) {
        await this.worktreeManager.restoreBranch(this.originalBranch);
      }
    }
  }

  /**
   * Resume an interrupted run.
   */
  async resume(runState: RunState): Promise<RunState> {
    // Save original branch to restore later
    this.originalBranch = await this.worktreeManager.getCurrentBranch();

    this.runState = runState;

    // Rebuild graph from issues
    this.graph = this.graphBuilder.build(runState.issues);

    // Update status
    this.runState.status = 'running';
    this.runState.updatedAt = new Date().toISOString();
    await this.store.saveRun(this.runState);

    // Continue from where we left off
    try {
      return await this.executeScheduler(
        runState.id,
        runState.runBranch,
        runState.issues
      );
    } finally {
      // Restore original branch
      if (this.originalBranch) {
        await this.worktreeManager.restoreBranch(this.originalBranch);
      }
    }
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
        if (this.progressDisplay) {
          this.progressDisplay.logDetailed(issueNumber, 'Creating worktree...');
        } else {
          console.log(chalk.blue(`   Creating worktree for #${issueNumber}...`));
        }
        const worktree = await this.worktreeManager.createWorktree(
          runId,
          issueNumber,
          runBranch
        );
        await this.store.saveWorktree(worktree);

        // Check for prior work from dependencies
        const dependencies = this.graph!.getDependencies(issueNumber);
        const completedDeps = dependencies
          .map(depNum => this.runState!.tasks.find(t => t.issueNumber === depNum))
          .filter((task): task is Task => !!task && !!task.summary);

        let hasPriorWork = false;
        if (completedDeps.length > 0) {
          // Write MILLHOUSE_PRIOR_WORK.md to the worktree
          const content = completedDeps.map(task => {
            const depIssue = issueMap.get(task.issueNumber);
            return `# #${task.issueNumber}: ${depIssue?.title || 'Unknown'}\n\n${task.summary}`;
          }).join('\n\n---\n\n');

          const priorWorkPath = path.join(worktree.path, 'MILLHOUSE_PRIOR_WORK.md');
          await fs.writeFile(priorWorkPath, content);
          hasPriorWork = true;

          if (this.progressDisplay) {
            this.progressDisplay.logDetailed(issueNumber, `Loaded ${completedDeps.length} prior work summary(ies)`);
          }
        }

        // Run Claude
        if (this.progressDisplay) {
          this.progressDisplay.logDetailed(issueNumber, 'Running Claude...');
        } else {
          console.log(chalk.blue(`   Running Claude for #${issueNumber}...`));
        }
        const result = await this.claudeRunner.run(issue, runId, worktree.path, hasPriorWork);

        if (result.success) {
          // Read summary file if it exists
          const summaryPath = path.join(worktree.path, 'MILLHOUSE_SUMMARY.md');
          try {
            const summary = await fs.readFile(summaryPath, 'utf-8');
            const task = this.runState!.tasks.find(t => t.issueNumber === issueNumber);
            if (task) {
              task.summary = summary;
            }
          } catch {
            // Summary file is optional - worker may not have created one
          }

          // Verify worker merged their changes into the run branch
          if (this.progressDisplay) {
            this.progressDisplay.logDetailed(issueNumber, 'Verifying merge...');
          } else {
            console.log(chalk.blue(`   Verifying merge for #${issueNumber}...`));
          }
          const verifyResult = await this.worktreeManager.verifyWorkerMerge(
            worktree.path,
            runBranch
          );

          if (!verifyResult.success) {
            return {
              success: false,
              commits: result.commits,
              error: verifyResult.error || 'Worker did not merge changes into run branch',
            };
          }
        }

        // Clean up worktree and its branch
        await this.worktreeManager.removeWorktree(worktree.path, worktree.branch);
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

    // Create PR if all completed (GitHub mode only)
    if (failed.length === 0 && completed.length > 0) {
      if (this.githubClient) {
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
      } else {
        // Local mode - merge run branch into original branch
        try {
          console.log(chalk.blue('   Merging changes into current branch...'));
          await this.worktreeManager.mergeRunBranch(runBranch, this.originalBranch!);
          this.runState.status = 'completed';
        } catch (error) {
          this.runState.error = error instanceof Error ? error.message : String(error);
          this.runState.status = 'failed';
        }
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
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-started', issueNumber: event.issueNumber! });
        } else {
          console.log(chalk.cyan(`   ▶ Started: #${event.issueNumber}`));
        }
        if (this.labelManager) {
          await this.labelManager.markInProgress(event.issueNumber!);
        }
        this.updateTaskStatus(event.issueNumber!, 'in-progress');
        break;

      case 'task-completed':
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-completed', issueNumber: event.issueNumber! });
        } else {
          console.log(chalk.green(`   ✓ Completed: #${event.issueNumber}`));
        }
        if (this.labelManager) {
          await this.labelManager.markDone(event.issueNumber!);
        }
        this.updateTaskStatus(event.issueNumber!, 'completed', event.commits);
        break;

      case 'task-failed':
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-failed', issueNumber: event.issueNumber!, error: event.error || 'Unknown error' });
        } else {
          console.log(chalk.red(`   ✗ Failed: #${event.issueNumber} - ${event.error}`));
        }
        if (this.labelManager) {
          await this.labelManager.markFailed(event.issueNumber!);
        }
        if (this.githubClient) {
          await this.githubClient.addComment(
            event.issueNumber!,
            `❌ Millhouse failed to implement this issue:\n\n\`\`\`\n${event.error}\n\`\`\``
          );
        }
        this.updateTaskStatus(event.issueNumber!, 'failed', undefined, event.error);
        break;

      case 'tasks-unblocked':
        if (this.progressDisplay) {
          for (const num of event.issueNumbers!) {
            this.progressDisplay.handleEvent({ type: 'issue-unblocked', issueNumber: num });
          }
        } else {
          console.log(chalk.cyan(`   ⏳ Unblocked: ${event.issueNumbers!.map(n => `#${n}`).join(', ')}`));
        }
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

    return this.githubClient!.createPullRequest({
      title,
      body,
      head: runBranch,
      base: this.config.execution.baseBranch,
      draft: this.config.pullRequests.createAsDraft,
    });
  }
}
