import readline from 'node:readline';
import chalk from 'chalk';
import { GitHubClient } from '../../github/client.js';
import { IssueDiscoverer } from '../../github/issue-discoverer.js';
import { IssueAnalyzer } from '../../analysis/issue-analyzer.js';
import { WorklistStore } from '../../storage/worklist-store.js';
import type { Worklist, WorklistItem } from '../../types.js';

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

export async function loadCommand(issues?: string): Promise<void> {
  const store = new WorklistStore();

  // Check if worklist already exists
  if (await store.exists()) {
    console.log(chalk.yellow('\nWorklist already exists.\n'));
    const choice = await prompt(
      '  [d] Delete and create new\n  [c] Cancel\n\nChoice: '
    );

    if (choice !== 'd') {
      console.log('Cancelled.');
      return;
    }
  }

  console.log(chalk.bold('\nLoading issues from GitHub...\n'));

  // Connect to GitHub
  let client: GitHubClient;
  try {
    client = new GitHubClient();
    console.log(chalk.gray(`Repository: ${client.repoOwner}/${client.repoName}\n`));
  } catch (error) {
    console.error(chalk.red(`Failed to connect to GitHub: ${error instanceof Error ? error.message : error}`));
    process.exit(1);
  }

  // Determine which issues to load
  let issueNumbers: number[];

  if (issues) {
    // Parse comma-separated issue numbers
    issueNumbers = issues.split(',').map(s => {
      const num = parseInt(s.trim(), 10);
      if (isNaN(num) || num <= 0) {
        console.error(chalk.red(`Invalid issue number: ${s}`));
        process.exit(1);
      }
      return num;
    });
    console.log(chalk.gray(`Starting issues: ${issueNumbers.map(n => `#${n}`).join(', ')}`));
  } else {
    // Load all open issues
    console.log(chalk.gray('Fetching all open issues...'));
    const openIssues = await client.listOpenIssues();
    issueNumbers = openIssues.map(i => i.number);

    if (issueNumbers.length === 0) {
      console.log(chalk.yellow('No open issues found.'));
      process.exit(0);
    }

    console.log(chalk.gray(`Found ${issueNumbers.length} open issues`));
  }

  // Discover linked issues
  console.log(chalk.gray('\nDiscovering linked issues...'));
  const discoverer = new IssueDiscoverer(client);
  const fetchedIssues = await discoverer.discover(issueNumbers, true);

  console.log(chalk.green(`\n✓ Found ${fetchedIssues.length} issues\n`));

  // Analyze dependencies using Claude
  console.log(chalk.gray('Analyzing dependencies...'));
  const analyzer = new IssueAnalyzer();
  const analysisResult = await analyzer.analyzeIssues(fetchedIssues);

  console.log(chalk.green(`\n✓ Analysis complete\n`));

  // Create mapping from GitHub issue number to internal ID
  const githubToId = new Map<number, number>();
  analysisResult.issues.forEach((issue, index) => {
    githubToId.set(issue.number, index + 1);
  });

  // Convert to WorklistItems
  const items: WorklistItem[] = analysisResult.issues.map((issue, index) => {
    // Convert GitHub issue number dependencies to internal IDs
    const internalDeps = issue.dependencies
      .map(dep => githubToId.get(dep))
      .filter((id): id is number => id !== undefined);

    return {
      id: index + 1,
      title: issue.title,
      body: issue.body || '',
      dependencies: internalDeps,
      status: 'pending' as const,
      githubIssueNumber: issue.number,
      noWorkNeeded: issue.noWorkNeeded,
    };
  });

  const worklist: Worklist = {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'github',
    title: analysisResult.title,
    description: analysisResult.description,
    items,
  };

  await store.save(worklist);

  console.log(chalk.green(`✓ Created worklist with ${items.length} items`));
  console.log(chalk.gray('  Run "millhouse list" to see items'));
  console.log(chalk.gray('  Run "millhouse run" to execute'));
}
