import { exec } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorktreeInfo } from '../types.js';

const execAsync = promisify(exec);

export class WorktreeManager {
  private basePath: string;
  private worktreesDir: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
    this.worktreesDir = path.join(basePath, '.millhouse', 'worktrees');
  }

  /**
   * Create the run branch from the base branch.
   */
  async createRunBranch(runId: string, baseBranch: string): Promise<string> {
    const runBranch = `millhouse/run-${runId}`;

    // Fetch latest from remote
    try {
      await execAsync('git fetch origin', { cwd: this.basePath });
    } catch {
      // Might not have remote, continue anyway
    }

    // Create the run branch from base
    try {
      await execAsync(
        `git checkout -b ${runBranch} origin/${baseBranch}`,
        { cwd: this.basePath }
      );
    } catch {
      // Try without origin/ prefix
      await execAsync(
        `git checkout -b ${runBranch} ${baseBranch}`,
        { cwd: this.basePath }
      );
    }

    // Go back to original branch
    await execAsync(`git checkout -`, { cwd: this.basePath });

    return runBranch;
  }

  /**
   * Create an isolated worktree for an issue.
   * Each issue gets its own branch to allow parallel worktrees.
   */
  async createWorktree(runId: string, issueNumber: number, runBranch: string): Promise<WorktreeInfo> {
    await fs.mkdir(this.worktreesDir, { recursive: true });

    const worktreePath = path.join(this.worktreesDir, `run-${runId}-issue-${issueNumber}`);
    // Each issue gets its own branch forked from the run branch
    // Use -issue- instead of /issue- to avoid git ref conflicts
    const issueBranch = `${runBranch}-issue-${issueNumber}`;

    // Remove existing worktree if any
    await this.removeWorktree(worktreePath).catch(() => {});

    // Delete the issue branch if it exists (from a previous failed run)
    await execAsync(`git branch -D ${issueBranch}`, { cwd: this.basePath }).catch(() => {});

    // Create worktree with a new branch forked from run branch
    await execAsync(
      `git worktree add -b ${issueBranch} "${worktreePath}" ${runBranch}`,
      { cwd: this.basePath }
    );

    const worktreeInfo: WorktreeInfo = {
      issueNumber,
      runId,
      path: worktreePath,
      branch: issueBranch,
      createdAt: new Date().toISOString(),
    };

    return worktreeInfo;
  }

  /**
   * Get list of commits made in a worktree since it was created.
   */
  async getNewCommits(worktreePath: string, runBranch: string): Promise<string[]> {
    try {
      // Get commits that are in worktree HEAD but not in run branch
      const { stdout } = await execAsync(
        `git log ${runBranch}..HEAD --format=%H`,
        { cwd: worktreePath }
      );

      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Verify that the worker's changes have been merged into the run branch.
   * Workers write the merge commit hash to MILLHOUSE_MERGE_COMMIT after pushing.
   * We verify that commit is an ancestor of the current run branch.
   */
  async verifyWorkerMerge(worktreePath: string, runBranch: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Read the merge commit hash written by the worker
      const mergeCommitPath = path.join(worktreePath, 'MILLHOUSE_MERGE_COMMIT');
      let mergeCommit: string;

      try {
        const content = await fs.readFile(mergeCommitPath, 'utf-8');
        mergeCommit = content.trim();
      } catch {
        return {
          success: false,
          error: 'Worker did not write MILLHOUSE_MERGE_COMMIT file. The merge loop may have failed.',
        };
      }

      // Verify the merge commit is an ancestor of the run branch
      // This confirms the worker's push made it into the run branch
      try {
        await execAsync(
          `git merge-base --is-ancestor ${mergeCommit} ${runBranch}`,
          { cwd: this.basePath }
        );
        return { success: true };
      } catch {
        // The worker's merge commit is not in the run branch history
        const { stdout: runBranchHead } = await execAsync(
          `git rev-parse ${runBranch}`,
          { cwd: this.basePath }
        );
        const { stdout: logOutput } = await execAsync(
          `git log --oneline -5 ${runBranch}`,
          { cwd: this.basePath }
        ).catch(() => ({ stdout: 'unable to get log' }));

        return {
          success: false,
          error: `Worker's merge commit (${mergeCommit.slice(0, 7)}) is not in run branch (${runBranchHead.trim().slice(0, 7)}). Run branch history:\n${logOutput}`,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Remove a worktree and its associated branch.
   */
  async removeWorktree(worktreePath: string, issueBranch?: string): Promise<void> {
    try {
      await execAsync(`git worktree remove "${worktreePath}" --force`, { cwd: this.basePath });
    } catch {
      // Try to remove directory manually if git worktree fails
      await fs.rm(worktreePath, { recursive: true, force: true });
      await execAsync('git worktree prune', { cwd: this.basePath }).catch(() => {});
    }

    // Clean up the issue branch if provided
    if (issueBranch) {
      await execAsync(`git branch -D ${issueBranch}`, { cwd: this.basePath }).catch(() => {});
    }
  }

  /**
   * Clean up all worktrees for a run.
   */
  async cleanupRun(_runId: string): Promise<void> {
    try {
      const entries = await fs.readdir(this.worktreesDir);

      for (const entry of entries) {
        const worktreePath = path.join(this.worktreesDir, entry);
        await this.removeWorktree(worktreePath);
      }
    } catch {
      // Directory might not exist
    }
  }

  /**
   * Push the run branch to remote.
   */
  async pushRunBranch(runBranch: string): Promise<void> {
    await execAsync(`git push -u origin ${runBranch}`, { cwd: this.basePath });
  }

  /**
   * Check if there are uncommitted changes in the main repo.
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: this.basePath });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    const { stdout } = await execAsync('git branch --show-current', { cwd: this.basePath });
    return stdout.trim();
  }

  /**
   * Merge the run branch into the target branch.
   * Used in local mode to bring changes into the working branch.
   */
  async mergeRunBranch(runBranch: string, targetBranch: string): Promise<void> {
    // Ensure we're on the target branch
    await execAsync(`git checkout "${targetBranch}"`, { cwd: this.basePath });

    // Merge the run branch
    await execAsync(`git merge ${runBranch} --no-edit`, { cwd: this.basePath });

    // Clean up temporary millhouse files from the merged result
    const tempFiles = ['MILLHOUSE_SUMMARY.md', 'MILLHOUSE_MERGE_COMMIT', 'MILLHOUSE_PRIOR_WORK.md'];
    const filesToRemove: string[] = [];

    for (const file of tempFiles) {
      try {
        await fs.access(path.join(this.basePath, file));
        filesToRemove.push(file);
      } catch {
        // File doesn't exist, skip
      }
    }

    if (filesToRemove.length > 0) {
      await execAsync(`git rm -f ${filesToRemove.join(' ')}`, { cwd: this.basePath });
      await execAsync(`git commit -m "chore: remove temporary millhouse files"`, { cwd: this.basePath });
    }
  }

  /**
   * Restore to a specific branch, aborting any in-progress merge.
   */
  async restoreBranch(branchName: string): Promise<void> {
    // Abort any in-progress merge
    try {
      await execAsync('git merge --abort', { cwd: this.basePath });
    } catch {
      // No merge in progress, that's fine
    }

    // Abort any in-progress rebase
    try {
      await execAsync('git rebase --abort', { cwd: this.basePath });
    } catch {
      // No rebase in progress, that's fine
    }

    // Discard any uncommitted changes
    try {
      await execAsync('git checkout -- .', { cwd: this.basePath });
    } catch {
      // Might fail if no changes, that's fine
    }

    // Switch back to original branch
    try {
      await execAsync(`git checkout "${branchName}"`, { cwd: this.basePath });
    } catch {
      // Branch might not exist or other issue
    }
  }
}
