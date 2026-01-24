import { z } from 'zod';

// =============================================================================
// Work Items (abstraction for both GitHub issues and local items)
// =============================================================================

// Base work item interface - common to both GitHub and local modes
export interface WorkItem {
  id: number;
  title: string;
  body: string | null;
  dependencies: number[]; // IDs of items this depends on
  affectedPaths: string[];
}

// Analyzed work item ready for execution
export interface AnalyzedWorkItem extends WorkItem {
  analyzedAt: string;
}

// =============================================================================
// GitHub-specific types
// =============================================================================

// GitHub Issue
export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
  htmlUrl: string;
}

// Issue with analysis results (for backward compatibility)
export interface AnalyzedIssue extends GitHubIssue {
  affectedPaths: string[];
  dependencies: number[]; // Issue numbers this depends on
  analyzedAt: string;
}

// Convert AnalyzedIssue to AnalyzedWorkItem
export function issueToWorkItem(issue: AnalyzedIssue): AnalyzedWorkItem {
  return {
    id: issue.number,
    title: issue.title,
    body: issue.body,
    dependencies: issue.dependencies,
    affectedPaths: issue.affectedPaths,
    analyzedAt: issue.analyzedAt,
  };
}

// Task status
export type TaskStatus =
  | 'queued'
  | 'blocked'
  | 'ready'
  | 'in-progress'
  | 'completed'
  | 'failed';

// Task representing work on an issue
export interface Task {
  issueNumber: number;
  status: TaskStatus;
  worktreePath?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  commits?: string[];
  summary?: string; // Raw markdown content from MILLHOUSE_SUMMARY.md
}

// Run state persisted to JSON
export interface RunState {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  mode?: 'plan' | 'github';  // Optional for backwards compatibility with old runs
  baseBranch: string;
  runBranch: string;
  issues: AnalyzedIssue[];
  tasks: Task[];
  completedIssues: number[];
  failedIssues: number[];
  pullRequestUrl?: string;
  error?: string;
}

// Worktree info
export interface WorktreeInfo {
  issueNumber: number;
  runId: string;
  path: string;
  branch: string;
  createdAt: string;
}

// Configuration schema
export const ConfigSchema = z.object({
  execution: z.object({
    concurrency: z.number().min(1).max(16).default(8),
    baseBranch: z.string().default('main'),
    maxBudgetPerIssue: z.number().positive().default(5.0),
    maxTotalBudget: z.number().positive().default(100.0),
    continueOnError: z.boolean().default(true),
  }).default({}),
  pullRequests: z.object({
    createAsDraft: z.boolean().default(true),
    mergeStrategy: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    branchPrefix: z.string().default('millhouse/issue-'),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// Millhouse labels
export const MILLHOUSE_LABELS = {
  QUEUED: 'millhouse:queued',
  IN_PROGRESS: 'millhouse:in-progress',
  BLOCKED: 'millhouse:blocked',
  FAILED: 'millhouse:failed',
  DONE: 'millhouse:done',
} as const;

export type MillhouseLabel = typeof MILLHOUSE_LABELS[keyof typeof MILLHOUSE_LABELS];

// Event types for scheduler
export type SchedulerEvent =
  | { type: 'task-started'; issueNumber: number }
  | { type: 'task-completed'; issueNumber: number; commits: string[] }
  | { type: 'task-failed'; issueNumber: number; error: string }
  | { type: 'tasks-unblocked'; issueNumbers: number[] };

// =============================================================================
// JSON Plan format (pre-analyzed plan for fast execution)
// =============================================================================

export interface JsonPlanItem {
  id: number;
  title: string;
  body: string;
  dependencies: number[];
}

export interface JsonPlan {
  version: 1;
  name?: string;
  createdAt: string;
  sourcePlan?: string; // Path to original markdown plan
  items: JsonPlanItem[];
}
