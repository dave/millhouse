import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { RunState, WorktreeInfo } from '../types.js';

const MILLHOUSE_DIR = '.millhouse';
const RUNS_DIR = 'runs';
const WORKTREES_FILE = 'worktrees.json';

export class JsonStore {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  private get millhouseDir(): string {
    return path.join(this.basePath, MILLHOUSE_DIR);
  }

  private get runsDir(): string {
    return path.join(this.millhouseDir, RUNS_DIR);
  }

  private get worktreesPath(): string {
    return path.join(this.millhouseDir, WORKTREES_FILE);
  }

  async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });
    await this.ensureGitignore();
  }

  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.basePath, '.gitignore');
    const entry = '.millhouse';

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      // Check if .millhouse is already in gitignore (as whole line)
      const lines = content.split('\n');
      if (lines.some(line => line.trim() === entry)) {
        return; // Already present
      }
      // Append to existing gitignore
      const newContent = content.endsWith('\n') ? content + entry + '\n' : content + '\n' + entry + '\n';
      await fs.writeFile(gitignorePath, newContent);
    } catch {
      // No .gitignore exists, create one
      await fs.writeFile(gitignorePath, entry + '\n');
    }
  }

  generateRunId(): string {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `${timestamp}-${random}`;
  }

  // Run state operations

  async saveRun(run: RunState): Promise<void> {
    await this.ensureDirectories();
    const filePath = path.join(this.runsDir, `${run.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(run, null, 2));
  }

  async getRun(runId: string): Promise<RunState | null> {
    const filePath = path.join(this.runsDir, `${runId}.json`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as RunState;
    } catch {
      return null;
    }
  }

  async listRuns(): Promise<RunState[]> {
    await this.ensureDirectories();
    const files = await fs.readdir(this.runsDir);
    const runs: RunState[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = await fs.readFile(path.join(this.runsDir, file), 'utf-8');
        runs.push(JSON.parse(content) as RunState);
      }
    }

    // Sort by creation date, newest first
    return runs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async deleteRun(runId: string): Promise<void> {
    const filePath = path.join(this.runsDir, `${runId}.json`);
    await fs.unlink(filePath).catch(() => {});
  }

  // Worktree tracking

  async getWorktrees(): Promise<WorktreeInfo[]> {
    try {
      const content = await fs.readFile(this.worktreesPath, 'utf-8');
      return JSON.parse(content) as WorktreeInfo[];
    } catch {
      return [];
    }
  }

  async saveWorktree(worktree: WorktreeInfo): Promise<void> {
    await this.ensureDirectories();
    const worktrees = await this.getWorktrees();
    worktrees.push(worktree);
    await fs.writeFile(this.worktreesPath, JSON.stringify(worktrees, null, 2));
  }

  async removeWorktree(path: string): Promise<void> {
    const worktrees = await this.getWorktrees();
    const filtered = worktrees.filter(w => w.path !== path);
    await fs.writeFile(this.worktreesPath, JSON.stringify(filtered, null, 2));
  }

  async getWorktreeForIssue(runId: string, issueNumber: number): Promise<WorktreeInfo | undefined> {
    const worktrees = await this.getWorktrees();
    return worktrees.find(w => w.runId === runId && w.issueNumber === issueNumber);
  }

  async getWorktreesForRun(runId: string): Promise<WorktreeInfo[]> {
    const worktrees = await this.getWorktrees();
    return worktrees.filter(w => w.runId === runId);
  }
}
