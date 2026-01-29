import chalk from 'chalk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitHubIssue, AnalyzedIssue, RunState, Task } from '../types.js';
import type { JsonStore } from '../storage/json-store.js';
import type { GitHubClient } from '../github/client.js';
import type { IssueDiscoverer } from '../github/issue-discoverer.js';
import type { IssueAnalyzer } from '../analysis/issue-analyzer.js';
import type { GraphBuilder, DependencyGraph } from '../analysis/graph-builder.js';
import type { WorktreeManager } from '../execution/worktree-manager.js';
import type { ClaudeRunner } from '../execution/claude-runner.js';
import type { Scheduler } from './scheduler.js';
import type { ProgressDisplay } from '../cli/progress-display.js';

interface OrchestratorOptions {
  store: JsonStore;
  graphBuilder: GraphBuilder;
  worktreeManager: WorktreeManager;
  claudeRunner: ClaudeRunner;
  scheduler: Scheduler;
  // GitHub-specific (optional for load command)
  githubClient?: GitHubClient;
  issueDiscoverer?: IssueDiscoverer;
  issueAnalyzer?: IssueAnalyzer;
  progressDisplay?: ProgressDisplay;
}

export class Orchestrator {
  private store: JsonStore;
  private graphBuilder: GraphBuilder;
  private worktreeManager: WorktreeManager;
  private claudeRunner: ClaudeRunner;
  private scheduler: Scheduler;
  // GitHub-specific (optional for load command)
  private githubClient?: GitHubClient;
  private issueDiscoverer?: IssueDiscoverer;
  private issueAnalyzer?: IssueAnalyzer;
  private progressDisplay?: ProgressDisplay;

  private runState: RunState | null = null;
  private graph: DependencyGraph | null = null;
  private isShuttingDown = false;
  private originalBranch: string | null = null;

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.graphBuilder = options.graphBuilder;
    this.worktreeManager = options.worktreeManager;
    this.claudeRunner = options.claudeRunner;
    this.scheduler = options.scheduler;
    // GitHub-specific
    this.githubClient = options.githubClient;
    this.issueDiscoverer = options.issueDiscoverer;
    this.issueAnalyzer = options.issueAnalyzer;
    this.progressDisplay = options.progressDisplay;

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
    const result = await this.issueAnalyzer.analyzeIssues(issues);
    return result.issues;
  }

  /**
   * Check that the working directory is clean before starting a run.
   * Only allows files that are gitignored - all other changes must be committed or stashed.
   * Special case: if only CLAUDE.md is untracked, auto-commit it.
   */
  private async checkWorkingDirectoryClean(): Promise<void> {
    const { execSync } = await import('node:child_process');

    const isGitIgnored = (filePath: string): boolean => {
      try {
        // git check-ignore exits 0 if ignored, 1 if not ignored
        execSync(`git check-ignore -q "${filePath}"`, {
          cwd: process.cwd(),
          stdio: 'pipe',
        });
        return true;
      } catch {
        return false;
      }
    };

    try {
      const status = execSync('git status --porcelain', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      }).trim();

      if (status) {
        const lines = status.split('\n');
        // Filter out gitignored files
        const unexpectedLines = lines.filter(line => {
          // Extract the file path from porcelain status line
          // Format is "XY PATH" but XY may be shortened, so find path after leading status chars
          const filePath = line.replace(/^[ MADRCU?!]{1,2}\s/, '');
          // Always ignore .millhouse/ internal working files
          if (filePath.startsWith('.millhouse/') || filePath === '.millhouse') {
            return false;
          }
          return !isGitIgnored(filePath);
        });

        if (unexpectedLines.length > 0) {
          // Special case: if only CLAUDE.md is untracked, auto-commit it
          if (unexpectedLines.length === 1 && unexpectedLines[0] === '?? CLAUDE.md') {
            console.log(chalk.blue('   Auto-committing CLAUDE.md...'));
            execSync('git add CLAUDE.md && git commit -m "chore: add CLAUDE.md"', {
              cwd: process.cwd(),
              stdio: 'pipe',
            });
            return;
          }

          const untracked = unexpectedLines.filter(l => l.startsWith('??'));
          const modified = unexpectedLines.filter(l => !l.startsWith('??'));

          const issues: string[] = [];
          if (modified.length > 0) {
            issues.push(`${modified.length} uncommitted change(s)`);
          }
          if (untracked.length > 0) {
            issues.push(`${untracked.length} untracked file(s)`);
          }

          console.log(chalk.yellow(`\n⚠ Working directory is not clean: ${issues.join(', ')}`));
          console.log(chalk.gray('  These files may cause merge conflicts at the end of the run:'));
          for (const line of unexpectedLines.slice(0, 10)) {
            console.log(chalk.gray(`    ${line}`));
          }
          if (unexpectedLines.length > 10) {
            console.log(chalk.gray(`    ... and ${unexpectedLines.length - 10} more`));
          }
          console.log(chalk.gray('\n  Commit or stash these changes before running.\n'));
          throw new Error('Working directory is not clean. Commit or stash changes before running.');
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Working directory is not clean')) {
        throw error;
      }
      // If git status fails for some other reason, continue
    }
  }

  /**
   * Run the full orchestration pipeline.
   */
  async run(analyzedIssues: AnalyzedIssue[]): Promise<RunState> {
    // Save original branch to restore later
    this.originalBranch = await this.worktreeManager.getCurrentBranch();

    // Check working directory is clean (allowing expected files)
    await this.checkWorkingDirectoryClean();

    // Check for CLAUDE.md
    const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
    try {
      await fs.access(claudeMdPath);
    } catch {
      console.log(chalk.yellow('\n⚠ No CLAUDE.md found.'));
      console.log(chalk.gray('  CLAUDE.md is highly recommended for best results.'));
      console.log(chalk.gray('  Run /init inside Claude Code to create it.'));
    }

    // Create run state
    const runId = this.store.generateRunId();

    // Build dependency graph
    this.graph = this.graphBuilder.build(analyzedIssues);

    // Check for cycles
    if (!this.graph.isAcyclic()) {
      const cycles = this.graph.getCycles();
      throw new Error(
        `Circular dependencies detected: ${cycles.map(c => c.map(n => `#${n}`).join(' → ')).join('; ')}`
      );
    }

    // Create run branch from current branch
    console.log(chalk.blue(`   Creating run branch: millhouse/run-${runId}`));
    const runBranch = await this.worktreeManager.createRunBranch(runId, this.originalBranch!);

    // Initialize run state
    this.runState = {
      id: runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      mode: this.githubClient ? 'github' : 'plan',
      baseBranch: this.originalBranch!,
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

    // Check working directory is clean (allowing expected files)
    await this.checkWorkingDirectoryClean();

    this.runState = runState;

    // Rebuild graph from issues
    this.graph = this.graphBuilder.build(runState.issues);

    // Update status
    this.runState.status = 'running';
    this.runState.updatedAt = new Date().toISOString();
    await this.store.saveRun(this.runState);

    // Initialize progress display
    if (this.progressDisplay) {
      this.progressDisplay.initialize(runState.issues);
      this.progressDisplay.start();
    }

    // Continue from where we left off
    try {
      return await this.executeScheduler(
        runState.id,
        runState.runBranch,
        runState.issues
      );
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

      // Handle noWorkNeeded issues - just create a closing commit
      if (issue.noWorkNeeded) {
        return await this.handleNoWorkNeededIssue(issue, runId, runBranch);
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

    // Merge run branch into current branch if any items completed
    if (failed.length === 0 && completed.length > 0) {
      try {
        console.log(chalk.blue('   Merging changes into current branch...'));
        await this.worktreeManager.mergeRunBranch(runBranch, this.originalBranch!);
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
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-started', issueNumber: event.issueNumber! });
        } else {
          console.log(chalk.cyan(`   ▶ Started: #${event.issueNumber}`));
        }
        this.updateTaskStatus(event.issueNumber!, 'in-progress');
        break;

      case 'task-completed':
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-completed', issueNumber: event.issueNumber! });
        } else {
          console.log(chalk.green(`   ✓ Completed: #${event.issueNumber}`));
        }
        this.updateTaskStatus(event.issueNumber!, 'completed', event.commits);
        break;

      case 'task-failed':
        if (this.progressDisplay) {
          this.progressDisplay.handleEvent({ type: 'issue-failed', issueNumber: event.issueNumber!, error: event.error || 'Unknown error' });
        } else {
          console.log(chalk.red(`   ✗ Failed: #${event.issueNumber} - ${event.error}`));
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
   * Handle issues marked as noWorkNeeded (index/meta issues).
   * Creates an empty commit to close the issue when merged.
   * Uses a worktree to avoid polluting the main working directory.
   */
  private async handleNoWorkNeededIssue(
    issue: AnalyzedIssue,
    runId: string,
    runBranch: string
  ): Promise<{ success: boolean; commits: string[]; error?: string }> {
    const issueNumber = issue.number;

    if (this.progressDisplay) {
      this.progressDisplay.logDetailed(issueNumber, 'No work needed - creating closing commit...');
    } else {
      console.log(chalk.blue(`   #${issueNumber}: No work needed - creating closing commit...`));
    }

    try {
      // Create worktree on its own branch (forked from run branch)
      const worktree = await this.worktreeManager.createWorktree(
        runId,
        issueNumber,
        runBranch
      );
      await this.store.saveWorktree(worktree);

      // Create an empty commit with the closing message
      // Only include "Fixes #X" if there's a real GitHub issue number
      let commitMessage = `chore: close task #${issueNumber} (no work needed)\n\nThis is a tracking/index issue that requires no code changes.`;
      if (issue.githubIssueNumber) {
        commitMessage += `\n\nFixes #${issue.githubIssueNumber}`;
      }

      const { execSync } = await import('node:child_process');
      execSync(`git commit --allow-empty -m "${commitMessage.replace(/"/g, '\\"')}"`, {
        cwd: worktree.path,
        stdio: 'pipe',
      });

      // Get the commit hash
      const commitHash = execSync('git rev-parse HEAD', {
        cwd: worktree.path,
        encoding: 'utf-8',
      }).trim();

      // Update the run branch to include this commit using git update-ref
      // This avoids checking out in the main working directory
      execSync(`git fetch "${worktree.path}" HEAD:${runBranch}`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      // Write MILLHOUSE_MERGE_COMMIT for consistency
      const mergeCommitPath = path.join(worktree.path, 'MILLHOUSE_MERGE_COMMIT');
      await fs.writeFile(mergeCommitPath, commitHash);

      // Clean up
      await this.worktreeManager.removeWorktree(worktree.path, worktree.branch);
      await this.store.removeWorktree(worktree.path);

      return { success: true, commits: [commitHash] };
    } catch (error) {
      return {
        success: false,
        commits: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
