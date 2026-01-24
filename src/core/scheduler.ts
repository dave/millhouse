import { EventEmitter } from 'node:events';
import type { DependencyGraph } from '../analysis/graph-builder.js';
import type { SchedulerEvent, TaskStatus } from '../types.js';

interface SchedulerOptions {
  concurrency: number;
  continueOnError: boolean;
}

interface TaskExecution {
  issueNumber: number;
  promise: Promise<{ success: boolean; commits: string[]; error?: string }>;
}

type TaskExecutor = (issueNumber: number) => Promise<{ success: boolean; commits: string[]; error?: string }>;

export class Scheduler extends EventEmitter {
  private readonly concurrency: number;
  private readonly continueOnError: boolean;

  private graph: DependencyGraph | null = null;
  private completed: Set<number> = new Set();
  private failed: Set<number> = new Set();
  private running: Map<number, TaskExecution> = new Map();
  private blocked: Set<number> = new Set();
  private aborted: boolean = false;

  constructor(options: SchedulerOptions) {
    super();
    this.concurrency = options.concurrency;
    this.continueOnError = options.continueOnError;
  }

  /**
   * Initialize the scheduler with a dependency graph.
   */
  initialize(graph: DependencyGraph, completed: number[] = [], failed: number[] = []): void {
    this.graph = graph;
    this.completed = new Set(completed);
    this.failed = new Set(failed);
    this.running = new Map();
    this.aborted = false;

    // Identify initially blocked issues
    const allIssues = graph.getAllIssues();
    for (const issue of allIssues) {
      if (!this.completed.has(issue) && !this.failed.has(issue)) {
        const deps = graph.getDependencies(issue);
        const hasPendingDeps = deps.some(d =>
          !this.completed.has(d) && !this.failed.has(d)
        );
        if (hasPendingDeps) {
          this.blocked.add(issue);
        }
      }
    }
  }

  /**
   * Get all tasks that are ready to run (dependencies satisfied, not running).
   */
  getReadyTasks(): number[] {
    if (!this.graph) return [];

    // If aborted, don't start any new tasks
    if (this.aborted) return [];

    const ready = this.graph.getReady(Array.from(this.completed));

    // Filter out already running, failed, and blocked-by-failed tasks
    return ready.filter(issue => {
      if (this.running.has(issue)) return false;
      if (this.failed.has(issue)) return false;

      // Check if blocked by a failed dependency (never run if dependency failed)
      if (this.isBlockedByFailure(issue)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check if a task is blocked by a failed dependency (directly or transitively).
   */
  private isBlockedByFailure(issue: number): boolean {
    if (!this.graph) return false;

    const visited = new Set<number>();
    const stack = [issue];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.graph.getDependencies(current);
      for (const dep of deps) {
        if (this.failed.has(dep)) {
          return true;
        }
        if (!this.completed.has(dep)) {
          stack.push(dep);
        }
      }
    }

    return false;
  }

  /**
   * Get the number of available slots for new tasks.
   */
  getAvailableSlots(): number {
    return Math.max(0, this.concurrency - this.running.size);
  }

  /**
   * Check if all tasks are complete (or blocked by failures, or aborted).
   */
  isComplete(): boolean {
    if (!this.graph) return true;

    // If aborted (continueOnError=false and a task failed), wait for running tasks then stop
    if (this.aborted && this.running.size === 0) {
      return true;
    }

    const allIssues = this.graph.getAllIssues();
    const pending = allIssues.filter(i =>
      !this.completed.has(i) &&
      !this.failed.has(i) &&
      !this.running.has(i)
    );

    // If nothing running and nothing pending, we're done
    if (this.running.size === 0 && pending.length === 0) {
      return true;
    }

    // If nothing running, check if any task can still start
    if (this.running.size === 0) {
      const ready = this.getReadyTasks();
      if (ready.length === 0) {
        return true; // All remaining tasks are blocked (by deps or failures)
      }
    }

    return false;
  }

  /**
   * Run the scheduler with the given task executor.
   * Returns when all possible tasks are complete.
   */
  async run(executor: TaskExecutor): Promise<{ completed: number[]; failed: number[] }> {
    if (!this.graph) {
      throw new Error('Scheduler not initialized');
    }

    while (!this.isComplete()) {
      // Start as many tasks as we can
      const ready = this.getReadyTasks();
      const slots = this.getAvailableSlots();
      const toStart = ready.slice(0, slots);

      for (const issueNumber of toStart) {
        this.startTask(issueNumber, executor);
      }

      // If nothing is running and nothing can start, we're stuck
      if (this.running.size === 0 && toStart.length === 0) {
        break;
      }

      // Wait for any running task to complete
      if (this.running.size > 0) {
        await this.waitForAny();
      }
    }

    return {
      completed: Array.from(this.completed),
      failed: Array.from(this.failed),
    };
  }

  /**
   * Start a single task.
   */
  private startTask(issueNumber: number, executor: TaskExecutor): void {
    this.blocked.delete(issueNumber);

    const promise = executor(issueNumber);
    this.running.set(issueNumber, { issueNumber, promise });

    this.emit('event', { type: 'task-started', issueNumber } as SchedulerEvent);

    // Handle completion
    promise.then(result => {
      this.handleTaskComplete(issueNumber, result);
    }).catch(error => {
      this.handleTaskComplete(issueNumber, {
        success: false,
        commits: [],
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Handle task completion.
   */
  private handleTaskComplete(
    issueNumber: number,
    result: { success: boolean; commits: string[]; error?: string }
  ): void {
    this.running.delete(issueNumber);

    if (result.success) {
      this.completed.add(issueNumber);
      this.emit('event', {
        type: 'task-completed',
        issueNumber,
        commits: result.commits,
      } as SchedulerEvent);

      // Check for newly unblocked tasks
      const unblocked = this.checkUnblockedTasks();
      if (unblocked.length > 0) {
        this.emit('event', { type: 'tasks-unblocked', issueNumbers: unblocked } as SchedulerEvent);
      }
    } else {
      this.failed.add(issueNumber);
      this.emit('event', {
        type: 'task-failed',
        issueNumber,
        error: result.error || 'Unknown error',
      } as SchedulerEvent);

      // If continueOnError is false, abort after this failure
      if (!this.continueOnError) {
        this.aborted = true;
      }
    }
  }

  /**
   * Check which blocked tasks are now unblocked.
   */
  private checkUnblockedTasks(): number[] {
    if (!this.graph) return [];

    const unblocked: number[] = [];

    for (const issue of this.blocked) {
      const deps = this.graph.getDependencies(issue);
      const allDepsCompleted = deps.every(d => this.completed.has(d));

      if (allDepsCompleted) {
        this.blocked.delete(issue);
        unblocked.push(issue);
      }
    }

    return unblocked;
  }

  /**
   * Wait for any running task to complete.
   */
  private async waitForAny(): Promise<void> {
    if (this.running.size === 0) return;

    const promises = Array.from(this.running.values()).map(t =>
      t.promise.then(() => t.issueNumber).catch(() => t.issueNumber)
    );

    await Promise.race(promises);

    // Small delay to allow completion handlers to run
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  /**
   * Get current status of all tasks.
   */
  getTaskStatuses(): Map<number, TaskStatus> {
    if (!this.graph) return new Map();

    const statuses = new Map<number, TaskStatus>();

    for (const issue of this.graph.getAllIssues()) {
      if (this.completed.has(issue)) {
        statuses.set(issue, 'completed');
      } else if (this.failed.has(issue)) {
        statuses.set(issue, 'failed');
      } else if (this.running.has(issue)) {
        statuses.set(issue, 'in-progress');
      } else if (this.isBlockedByFailure(issue)) {
        // Blocked by a failed dependency - will never run
        statuses.set(issue, 'blocked');
      } else if (this.blocked.has(issue)) {
        statuses.set(issue, 'blocked');
      } else {
        statuses.set(issue, 'ready');
      }
    }

    return statuses;
  }

  /**
   * Get counts of tasks in each status.
   */
  getStatusCounts(): Record<TaskStatus, number> {
    const counts: Record<TaskStatus, number> = {
      'queued': 0,
      'blocked': this.blocked.size,
      'ready': 0,
      'in-progress': this.running.size,
      'completed': this.completed.size,
      'failed': this.failed.size,
    };

    // Count ready tasks
    counts.ready = this.getReadyTasks().length;

    return counts;
  }
}
