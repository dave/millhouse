import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { WorklistStore } from '../../storage/worklist-store.js';
import type { WorklistItem } from '../../types.js';

export async function saveCommand(): Promise<void> {
  const store = new WorklistStore();
  const worklist = await store.load();

  if (!worklist) {
    console.error(chalk.red('No worklist found.'));
    console.log('Run "millhouse init" or "millhouse load" first.');
    process.exit(1);
  }

  if (worklist.items.length === 0) {
    console.error(chalk.red('Worklist is empty.'));
    process.exit(1);
  }

  // Check if any items already have issue numbers
  const hasIssues = worklist.items.some(i => i.githubIssueNumber !== undefined);
  if (hasIssues) {
    console.error(chalk.red('Worklist already has GitHub issue numbers.'));
    console.log('Cannot save again. To create new issues:');
    console.log('  1. Delete the worklist: rm .millhouse/worklist.json');
    console.log('  2. Run "millhouse init" or "millhouse load" again');
    process.exit(1);
  }

  // Verify gh CLI is available
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch {
    console.error(chalk.red('GitHub CLI (gh) not found.'));
    console.log('Install it from: https://cli.github.com/');
    process.exit(1);
  }

  // Verify gh is authenticated
  try {
    execSync('gh auth status', { stdio: 'ignore' });
  } catch {
    console.error(chalk.red('Not authenticated with GitHub CLI.'));
    console.log('Run: gh auth login');
    process.exit(1);
  }

  console.log(chalk.bold(`\nCreating ${worklist.items.length} GitHub issues...\n`));

  // Build dependency graph and sort topologically
  const sorted = topologicalSort(worklist.items);

  // Map internal ID -> GitHub issue number
  const idToIssue = new Map<number, number>();

  const spinner = ora();

  for (const item of sorted) {
    spinner.start(`Creating issue: ${item.title}`);

    try {
      // Build the body with GitHub issue numbers for dependencies
      let body = item.body;

      // Replace internal dependency references with GitHub issue numbers
      for (const depId of item.dependencies) {
        const githubNum = idToIssue.get(depId);
        if (githubNum) {
          // Replace #N with actual GitHub issue number
          body = body.replace(
            new RegExp(`#${depId}\\b`, 'g'),
            `#${githubNum}`
          );
          // Also replace "Depends on #N" style references
          body = body.replace(
            new RegExp(`(depends on|blocked by|after|requires)\\s+#${depId}\\b`, 'gi'),
            `$1 #${githubNum}`
          );
        }
      }

      // Add dependency info at the start of the body
      if (item.dependencies.length > 0) {
        const depRefs = item.dependencies
          .map(d => `#${idToIssue.get(d) || d}`)
          .join(', ');
        body = `**Depends on:** ${depRefs}\n\n${body}`;
      }

      // Create issue using gh CLI
      const issueNumber = createGitHubIssue(item.title, body);
      idToIssue.set(item.id, issueNumber);
      item.githubIssueNumber = issueNumber;

      spinner.succeed(`Created #${issueNumber}: ${item.title}`);
    } catch (error) {
      spinner.fail(`Failed to create: ${item.title}`);
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
      // Continue with other issues
    }
  }

  // Create index issue
  if (idToIssue.size > 0) {
    spinner.start('Creating index issue...');

    try {
      const indexBody = buildIndexBody(worklist.items, idToIssue);
      const indexNumber = createGitHubIssue('Implementation Index', indexBody);
      spinner.succeed(`Created index issue: #${indexNumber}`);
    } catch (error) {
      spinner.fail('Failed to create index issue');
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
    }
  }

  // Save updated worklist
  await store.save(worklist);

  console.log(chalk.green(`\n✓ Created ${idToIssue.size} issues`));
  console.log(chalk.gray('  Run "millhouse run" to execute'));
}

function createGitHubIssue(title: string, body: string): number {
  // Escape for shell
  const escapedTitle = title.replace(/"/g, '\\"').replace(/`/g, '\\`');
  const escapedBody = body.replace(/"/g, '\\"').replace(/`/g, '\\`');

  const result = execSync(
    `gh issue create --title "${escapedTitle}" --body "${escapedBody}"`,
    { encoding: 'utf-8' }
  );

  // Parse issue number from URL
  // Output is like: https://github.com/owner/repo/issues/123
  const match = result.match(/issues\/(\d+)/);
  if (!match) {
    throw new Error('Failed to parse issue number from gh output');
  }

  return parseInt(match[1], 10);
}

function buildIndexBody(
  items: WorklistItem[],
  idToIssue: Map<number, number>
): string {
  const lines = items.map(item => {
    const ghNum = idToIssue.get(item.id);
    if (!ghNum) return null;

    let deps = '';
    if (item.dependencies.length > 0) {
      const depRefs = item.dependencies
        .map(d => `#${idToIssue.get(d) || d}`)
        .join(', ');
      deps = ` (depends on ${depRefs})`;
    }

    return `- #${ghNum} ${item.title}${deps}`;
  }).filter(Boolean);

  return `## Issues

${lines.join('\n')}

## Run

\`\`\`bash
millhouse run
\`\`\`
`;
}

function topologicalSort(items: WorklistItem[]): WorklistItem[] {
  const sorted: WorklistItem[] = [];
  const visited = new Set<number>();
  const visiting = new Set<number>();

  const itemMap = new Map(items.map(i => [i.id, i]));

  function visit(item: WorklistItem): void {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) {
      throw new Error(`Circular dependency detected at item ${item.id}`);
    }

    visiting.add(item.id);

    for (const depId of item.dependencies) {
      const dep = itemMap.get(depId);
      if (dep) {
        visit(dep);
      }
    }

    visiting.delete(item.id);
    visited.add(item.id);
    sorted.push(item);
  }

  for (const item of items) {
    visit(item);
  }

  return sorted;
}
