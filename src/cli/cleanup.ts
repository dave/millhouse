import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { RunState } from '../types.js';

const MILLHOUSE_DIR = '.millhouse';

export interface LeftoverState {
  hasLeftovers: boolean;
  interruptedRuns: RunState[];
  worktreeDirs: string[];
  millhouseBranches: string[];
}

/**
 * Detect leftover state from previous interrupted runs.
 */
export async function detectLeftoverState(basePath: string = process.cwd()): Promise<LeftoverState> {
  const result: LeftoverState = {
    hasLeftovers: false,
    interruptedRuns: [],
    worktreeDirs: [],
    millhouseBranches: [],
  };

  const millhouseDir = path.join(basePath, MILLHOUSE_DIR);

  // Check for interrupted/running runs
  const runsDir = path.join(millhouseDir, 'runs');
  try {
    const runFiles = await fs.readdir(runsDir);
    for (const file of runFiles) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(runsDir, file), 'utf-8');
        const run = JSON.parse(content) as RunState;
        if (run.status === 'running' || run.status === 'interrupted') {
          result.interruptedRuns.push(run);
        }
      }
    }
  } catch {
    // No runs directory
  }

  // Check for worktree directories
  const worktreesDir = path.join(millhouseDir, 'worktrees');
  try {
    const entries = await fs.readdir(worktreesDir);
    for (const entry of entries) {
      const fullPath = path.join(worktreesDir, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        result.worktreeDirs.push(fullPath);
      }
    }
  } catch {
    // No worktrees directory
  }

  // Check for millhouse branches
  try {
    const branches = execSync('git branch --list "millhouse/*"', {
      cwd: basePath,
      encoding: 'utf-8',
    }).trim();
    if (branches) {
      result.millhouseBranches = branches
        .split('\n')
        .map(b => b.trim().replace(/^\* /, ''))
        .filter(Boolean);
    }
  } catch {
    // Git command failed
  }

  result.hasLeftovers =
    result.interruptedRuns.length > 0 ||
    result.worktreeDirs.length > 0 ||
    result.millhouseBranches.length > 0;

  return result;
}

/**
 * Clean up all millhouse state - worktrees, branches, and run files.
 */
export async function cleanupAllState(basePath: string = process.cwd()): Promise<void> {
  const millhouseDir = path.join(basePath, MILLHOUSE_DIR);

  // Remove all worktree directories
  const worktreesDir = path.join(millhouseDir, 'worktrees');
  try {
    await fs.rm(worktreesDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  // Prune git worktrees
  try {
    execSync('git worktree prune', { cwd: basePath, stdio: 'ignore' });
  } catch {
    // Git command failed
  }

  // Delete all millhouse branches
  try {
    const branches = execSync('git branch --list "millhouse/*"', {
      cwd: basePath,
      encoding: 'utf-8',
    }).trim();

    if (branches) {
      const branchList = branches
        .split('\n')
        .map(b => b.trim().replace(/^\* /, ''))
        .filter(Boolean);

      for (const branch of branchList) {
        try {
          execSync(`git branch -D "${branch}"`, { cwd: basePath, stdio: 'ignore' });
        } catch {
          // Branch might be checked out or other issue
        }
      }
    }
  } catch {
    // Git command failed
  }

  // Clear run state files
  const runsDir = path.join(millhouseDir, 'runs');
  try {
    await fs.rm(runsDir, { recursive: true, force: true });
  } catch {
    // Directory might not exist
  }

  // Clear worktrees.json
  const worktreesFile = path.join(millhouseDir, 'worktrees.json');
  try {
    await fs.unlink(worktreesFile);
  } catch {
    // File might not exist
  }
}

/**
 * Display the leftover state to the user.
 */
export function displayLeftoverState(state: LeftoverState): void {
  console.log(chalk.yellow('\n⚠️  Found leftover state from a previous run:\n'));

  if (state.interruptedRuns.length > 0) {
    console.log(chalk.gray('   Interrupted runs:'));
    for (const run of state.interruptedRuns) {
      const issueCount = run.issues.length;
      const completed = run.completedIssues.length;
      console.log(`     - ${run.id} (${completed}/${issueCount} issues completed)`);
    }
  }

  if (state.worktreeDirs.length > 0) {
    console.log(chalk.gray('   Worktree directories:'));
    for (const dir of state.worktreeDirs) {
      console.log(`     - ${path.basename(dir)}`);
    }
  }

  if (state.millhouseBranches.length > 0) {
    console.log(chalk.gray('   Git branches:'));
    for (const branch of state.millhouseBranches) {
      console.log(`     - ${branch}`);
    }
  }

  console.log('');
}
