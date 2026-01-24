import { execSync } from 'node:child_process';
import readline from 'node:readline';
import chalk from 'chalk';
import ora from 'ora';
import { WorklistStore } from '../../storage/worklist-store.js';
import type { WorklistItem, Worklist } from '../../types.js';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function deleteGitHubIssue(issueNumber: number): void {
  execSync(`gh issue delete ${issueNumber} --yes`, { stdio: 'ignore' });
}

async function deleteExistingIssues(worklist: Worklist, spinner: ReturnType<typeof ora>): Promise<void> {
  // Collect all issue numbers to delete
  const issuesToDelete: number[] = [];

  for (const item of worklist.items) {
    if (item.githubIssueNumber !== undefined) {
      issuesToDelete.push(item.githubIssueNumber);
    }
  }

  if (worklist.indexIssueNumber !== undefined) {
    issuesToDelete.push(worklist.indexIssueNumber);
  }

  // Delete all issues (ignore errors - issues may have been manually deleted)
  for (const issueNum of issuesToDelete) {
    spinner.start(`Deleting issue #${issueNum}...`);
    try {
      deleteGitHubIssue(issueNum);
      spinner.succeed(`Deleted #${issueNum}`);
    } catch {
      // Issue may have been manually deleted - that's fine
      spinner.succeed(`#${issueNum} already deleted`);
    }
  }

  // Clear issue numbers from worklist
  for (const item of worklist.items) {
    delete item.githubIssueNumber;
  }
  delete worklist.indexIssueNumber;
}

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

  const spinner = ora();

  // Check if any items already have issue numbers
  const hasIssues = worklist.items.some(i => i.githubIssueNumber !== undefined) || worklist.indexIssueNumber !== undefined;
  if (hasIssues) {
    console.log(chalk.yellow('\nWorklist already has GitHub issues.\n'));
    const choice = await prompt(
      '  [d] Delete existing issues and recreate\n  [c] Cancel\n\nChoice: '
    );

    if (choice !== 'd') {
      console.log('Cancelled.');
      return;
    }

    console.log('');
    await deleteExistingIssues(worklist, spinner);
    console.log('');
  }

  console.log(chalk.bold(`\nCreating ${worklist.items.length} GitHub issues...\n`));

  // Build dependency graph and sort topologically
  const sorted = topologicalSort(worklist.items);

  // Map internal ID -> GitHub issue number
  const idToIssue = new Map<number, number>();

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
      const issue = createGitHubIssue(item.title, body);
      idToIssue.set(item.id, issue.number);
      item.githubIssueNumber = issue.number;

      spinner.succeed(`Created #${issue.number}: ${item.title}`);
    } catch (error) {
      spinner.fail(`Failed to create: ${item.title}`);
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
      // Continue with other issues
    }
  }

  // Create index issue
  let indexUrl: string | undefined;
  if (idToIssue.size > 0) {
    spinner.start('Creating index issue...');

    try {
      const indexTitle = worklist.title || 'Implementation Index';
      const indexBody = buildIndexBody(worklist, idToIssue);
      const indexIssue = createGitHubIssue(indexTitle, indexBody);
      indexUrl = indexIssue.url;
      worklist.indexIssueNumber = indexIssue.number;
      spinner.succeed(`Created index issue: #${indexIssue.number}`);
    } catch (error) {
      spinner.fail('Failed to create index issue');
      console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : error}`));
    }
  }

  // Save updated worklist
  await store.save(worklist);

  console.log(chalk.green(`\n✓ Created ${idToIssue.size} issues`));
  if (indexUrl) {
    console.log(chalk.cyan(`\n${indexUrl}`));
  }
  console.log(chalk.gray('\nRun "millhouse run" to execute'));
}

interface CreatedIssue {
  number: number;
  url: string;
}

function createGitHubIssue(title: string, body: string): CreatedIssue {
  // Escape for shell
  const escapedTitle = title.replace(/"/g, '\\"').replace(/`/g, '\\`');
  const escapedBody = body.replace(/"/g, '\\"').replace(/`/g, '\\`');

  const result = execSync(
    `gh issue create --title "${escapedTitle}" --body "${escapedBody}"`,
    { encoding: 'utf-8' }
  );

  // Parse issue number from URL
  // Output is like: https://github.com/owner/repo/issues/123
  const url = result.trim();
  const match = url.match(/issues\/(\d+)/);
  if (!match) {
    throw new Error('Failed to parse issue number from gh output');
  }

  return { number: parseInt(match[1], 10), url };
}

function buildIndexBody(
  worklist: Worklist,
  idToIssue: Map<number, number>
): string {
  const lines = worklist.items.map(item => {
    const ghNum = idToIssue.get(item.id);
    if (!ghNum) return null;

    let deps = '';
    if (item.dependencies.length > 0) {
      const depRefs = item.dependencies
        .map(d => `#${idToIssue.get(d) || d}`)
        .join(', ');
      deps = ` (depends on ${depRefs})`;
    }

    // GitHub auto-expands #N to show the issue title, so we don't need to repeat it
    return `- #${ghNum}${deps}`;
  }).filter(Boolean);

  const description = worklist.description ? `${worklist.description}\n\n` : '';

  return `${description}## Issues

${lines.join('\n')}
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
