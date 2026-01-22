import { execSync, exec } from 'node:child_process';
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
   * Merge changes from a worktree back into the run branch.
   * Returns true if successful, false if there were conflicts.
   */
  async mergeWorktree(worktreePath: string, runBranch: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the current HEAD of the worktree
      const { stdout: worktreeHead } = await execAsync(
        'git rev-parse HEAD',
        { cwd: worktreePath }
      );
      const commitHash = worktreeHead.trim();

      // Check if there are any new commits
      const commits = await this.getNewCommits(worktreePath, runBranch);
      if (commits.length === 0) {
        return { success: true };
      }

      // Switch to run branch in main repo and merge
      const originalBranch = execSync('git branch --show-current', {
        cwd: this.basePath,
        encoding: 'utf-8',
      }).trim();

      try {
        await execAsync(`git checkout ${runBranch}`, { cwd: this.basePath });
        await execAsync(`git merge ${commitHash} --no-edit`, { cwd: this.basePath });

        return { success: true };
      } finally {
        // Return to original branch if different
        if (originalBranch && originalBranch !== runBranch) {
          await execAsync(`git checkout ${originalBranch}`, { cwd: this.basePath }).catch(() => {});
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it's a merge conflict
      if (errorMessage.includes('CONFLICT') || errorMessage.includes('Merge conflict')) {
        // Abort the merge
        await execAsync('git merge --abort', { cwd: this.basePath }).catch(() => {});
        return { success: false, error: 'Merge conflict detected' };
      }

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
