import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Worklist, WorklistItem } from '../types.js';

const MILLHOUSE_DIR = '.millhouse';
const WORKLIST_FILE = 'worklist.json';

export class WorklistStore {
  private basePath: string;

  constructor(basePath: string = process.cwd()) {
    this.basePath = basePath;
  }

  private get millhouseDir(): string {
    return path.join(this.basePath, MILLHOUSE_DIR);
  }

  private get worklistPath(): string {
    return path.join(this.millhouseDir, WORKLIST_FILE);
  }

  async ensureDirectory(): Promise<void> {
    await fs.mkdir(this.millhouseDir, { recursive: true });
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.worklistPath);
      return true;
    } catch {
      return false;
    }
  }

  async load(): Promise<Worklist | null> {
    try {
      const content = await fs.readFile(this.worklistPath, 'utf-8');
      return JSON.parse(content) as Worklist;
    } catch {
      return null;
    }
  }

  async save(worklist: Worklist): Promise<void> {
    await this.ensureDirectory();
    worklist.updatedAt = new Date().toISOString();
    await fs.writeFile(this.worklistPath, JSON.stringify(worklist, null, 2));
  }

  async delete(): Promise<void> {
    try {
      await fs.unlink(this.worklistPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async updateItem(itemId: number, updates: Partial<WorklistItem>): Promise<void> {
    const worklist = await this.load();
    if (!worklist) {
      throw new Error('No worklist found');
    }

    const item = worklist.items.find(i => i.id === itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found in worklist`);
    }

    Object.assign(item, updates);
    await this.save(worklist);
  }

  async markCompleted(itemId: number): Promise<void> {
    await this.updateItem(itemId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  }

  async markFailed(itemId: number, error: string): Promise<void> {
    await this.updateItem(itemId, {
      status: 'failed',
      error,
    });
  }

  async getPendingItems(): Promise<WorklistItem[]> {
    const worklist = await this.load();
    if (!worklist) {
      return [];
    }
    return worklist.items.filter(i => i.status === 'pending');
  }

  async getReadyItems(): Promise<WorklistItem[]> {
    const worklist = await this.load();
    if (!worklist) {
      return [];
    }

    const completedIds = new Set(
      worklist.items.filter(i => i.status === 'completed').map(i => i.id)
    );

    return worklist.items.filter(item => {
      if (item.status !== 'pending') return false;
      // Check if all dependencies are completed
      return item.dependencies.every(dep => completedIds.has(dep));
    });
  }
}
