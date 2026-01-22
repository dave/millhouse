import chalk from 'chalk';
import { JsonStore } from '../../storage/json-store.js';
import type { RunState, TaskStatus } from '../../types.js';

interface StatusOptions {
  runId?: string;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  try {
    const store = new JsonStore();

    let runs: RunState[];
    if (options.runId) {
      const run = await store.getRun(options.runId);
      if (!run) {
        console.error(chalk.red(`Run not found: ${options.runId}`));
        process.exit(1);
      }
      runs = [run];
    } else {
      runs = await store.listRuns();
    }

    if (runs.length === 0) {
      console.log(chalk.yellow('No runs found.'));
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(runs, null, 2));
      return;
    }

    for (const run of runs) {
      printRunStatus(run);
    }
  } catch (error) {
    console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }
}

function printRunStatus(run: RunState): void {
  const statusColors: Record<string, (s: string) => string> = {
    running: chalk.blue,
    completed: chalk.green,
    failed: chalk.red,
    interrupted: chalk.yellow,
  };

  const statusColor = statusColors[run.status] || chalk.white;

  console.log(chalk.bold(`\n📦 Run: ${run.id}`));
  console.log(`   Status: ${statusColor(run.status)}`);
  console.log(`   Created: ${new Date(run.createdAt).toLocaleString()}`);
  console.log(`   Branch: ${run.runBranch}`);

  if (run.pullRequestUrl) {
    console.log(`   PR: ${chalk.blue(run.pullRequestUrl)}`);
  }

  // Task summary
  const tasksByStatus = groupBy(run.tasks, t => t.status);
  console.log('\n   Tasks:');

  const taskStatusDisplay: { status: TaskStatus; icon: string; color: (s: string) => string }[] = [
    { status: 'completed', icon: '✅', color: chalk.green },
    { status: 'in-progress', icon: '🔄', color: chalk.blue },
    { status: 'ready', icon: '⏳', color: chalk.cyan },
    { status: 'blocked', icon: '🚫', color: chalk.yellow },
    { status: 'queued', icon: '📋', color: chalk.gray },
    { status: 'failed', icon: '❌', color: chalk.red },
  ];

  for (const { status, icon, color } of taskStatusDisplay) {
    const tasks = tasksByStatus[status] || [];
    if (tasks.length > 0) {
      const issueNums = tasks.map(t => `#${t.issueNumber}`).join(', ');
      console.log(`     ${icon} ${color(status)}: ${issueNums}`);
    }
  }

  if (run.error) {
    console.log(chalk.red(`\n   Error: ${run.error}`));
  }
}

function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}
