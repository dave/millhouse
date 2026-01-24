import chalk from 'chalk';
import { WorklistStore } from '../../storage/worklist-store.js';
import type { WorklistItem } from '../../types.js';

interface ListOptions {
  verbose?: boolean;
}

export async function listCommand(options: ListOptions): Promise<void> {
  const verbose = options.verbose ?? false;
  const store = new WorklistStore();
  const worklist = await store.load();

  if (!worklist) {
    console.log(chalk.yellow('No worklist found.'));
    console.log('Run "millhouse init" or "millhouse load" first.');
    return;
  }

  if (worklist.items.length === 0) {
    console.log(chalk.yellow('Worklist is empty.'));
    return;
  }

  // Group by status
  const pending = worklist.items.filter(i => i.status === 'pending');
  const completed = worklist.items.filter(i => i.status === 'completed');
  const failed = worklist.items.filter(i => i.status === 'failed');

  // Calculate which pending items are blocked
  const completedIds = new Set(completed.map(i => i.id));
  const isBlocked = (item: WorklistItem) =>
    item.dependencies.some(dep => !completedIds.has(dep));

  const ready = pending.filter(i => !isBlocked(i));
  const blocked = pending.filter(i => isBlocked(i));

  console.log(chalk.bold(`\nWorklist: ${worklist.items.length} items\n`));

  // Show source
  if (worklist.source === 'github') {
    console.log(chalk.gray(`Source: GitHub issues\n`));
  } else {
    console.log(chalk.gray(`Source: Plan\n`));
  }

  // Ready items
  if (ready.length > 0) {
    console.log(chalk.green.bold(`Ready (${ready.length}):`));
    for (const item of ready) {
      displayItem(item, completedIds, verbose);
    }
    console.log();
  }

  // Blocked items
  if (blocked.length > 0) {
    console.log(chalk.yellow.bold(`Blocked (${blocked.length}):`));
    for (const item of blocked) {
      displayItem(item, completedIds, verbose);
    }
    console.log();
  }

  // Completed items
  if (completed.length > 0) {
    console.log(chalk.blue.bold(`Completed (${completed.length}):`));
    for (const item of completed) {
      displayItem(item, completedIds, verbose);
    }
    console.log();
  }

  // Failed items
  if (failed.length > 0) {
    console.log(chalk.red.bold(`Failed (${failed.length}):`));
    for (const item of failed) {
      displayItem(item, completedIds, verbose, true);
    }
    console.log();
  }

  // Summary
  console.log(chalk.gray('─'.repeat(50)));
  console.log(
    `  ${chalk.green('●')} ${ready.length} ready  ` +
    `${chalk.yellow('●')} ${blocked.length} blocked  ` +
    `${chalk.blue('●')} ${completed.length} done  ` +
    `${chalk.red('●')} ${failed.length} failed`
  );
}

function displayItem(
  item: WorklistItem,
  completedIds: Set<number>,
  verbose = false,
  showError = false
): void {
  const issueTag = item.githubIssueNumber
    ? chalk.cyan(` (#${item.githubIssueNumber})`)
    : '';

  let deps = '';
  if (item.dependencies.length > 0) {
    const depLabels = item.dependencies.map(dep => {
      const isComplete = completedIds.has(dep);
      return isComplete ? chalk.gray(`#${dep}`) : chalk.yellow(`#${dep}`);
    });
    deps = chalk.gray(` ← ${depLabels.join(', ')}`);
  }

  const statusIcon = getStatusIcon(item.status);
  console.log(`  ${statusIcon} ${item.id}. ${item.title}${issueTag}${deps}`);

  if (verbose && item.body) {
    // Indent each line of the body
    const indentedBody = item.body
      .split('\n')
      .map(line => `      ${line}`)
      .join('\n');
    console.log(chalk.gray(indentedBody));
    console.log();
  }

  if (showError && item.error) {
    console.log(chalk.red(`      Error: ${item.error}`));
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending':
      return chalk.gray('○');
    case 'completed':
      return chalk.green('✓');
    case 'failed':
      return chalk.red('✗');
    default:
      return chalk.gray('○');
  }
}
