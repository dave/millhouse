import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import chalk from 'chalk';
import { PlanParser } from '../../analysis/plan-parser.js';
import { WorklistStore } from '../../storage/worklist-store.js';
import type { Worklist, WorklistItem } from '../../types.js';

interface InitOptions {
  force?: boolean;
}

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

/**
 * Find plans associated with the current project by searching
 * Claude Code's session transcripts for plan file references.
 */
async function findProjectPlans(): Promise<string[]> {
  // Convert cwd to Claude project path format: /Users/dave/src/foo -> -Users-dave-src-foo
  const cwd = process.cwd();
  const projectDirName = cwd.replace(/\//g, '-');
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectDirName);

  const planRefs = new Set<string>();

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

    // Search transcript files for plan references
    for (const file of jsonlFiles) {
      try {
        const content = await fs.readFile(path.join(projectDir, file), 'utf-8');
        // Match plan file paths like .claude/plans/name.md or ~/.claude/plans/name.md
        const matches = content.match(/\.claude\/plans\/[a-z-]+\.md/g);
        if (matches) {
          for (const match of matches) {
            // Extract just the filename
            const filename = match.split('/').pop();
            if (filename) {
              planRefs.add(filename);
            }
          }
        }
      } catch {
        // Skip files we can't read
      }
    }
  } catch {
    // Project directory doesn't exist
  }

  return Array.from(planRefs);
}

/**
 * Find the most recent plan file for the current project.
 * Only looks at plans referenced in this project's session transcripts.
 */
async function findLatestPlan(): Promise<{ path: string; content: string } | null> {
  const plansDir = path.join(os.homedir(), '.claude', 'plans');

  // Get plans associated with this project
  const projectPlans = await findProjectPlans();

  if (projectPlans.length === 0) {
    return null;
  }

  try {
    const files = await fs.readdir(plansDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    // Filter to only project-specific plans
    const relevantFiles = mdFiles.filter(f => projectPlans.includes(f));

    if (relevantFiles.length === 0) {
      return null;
    }

    // Get stats for all files and sort by mtime
    const filesWithStats = await Promise.all(
      relevantFiles.map(async file => {
        const filePath = path.join(plansDir, file);
        const stats = await fs.stat(filePath);
        return { file, filePath, mtime: stats.mtime };
      })
    );

    filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const latest = filesWithStats[0];

    const content = await fs.readFile(latest.filePath, 'utf-8');
    return { path: latest.filePath, content };
  } catch {
    return null;
  }
}

export async function initCommand(options: InitOptions): Promise<void> {
  // Check for CLAUDE.md
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
  try {
    await fs.access(claudeMdPath);
  } catch {
    console.log(chalk.yellow('⚠ No CLAUDE.md found.'));
    console.log(chalk.gray('  CLAUDE.md is highly recommended for best results.'));
    console.log(chalk.gray('  Run /init inside Claude Code to create it.\n'));
  }

  const store = new WorklistStore();

  // Check if worklist already exists
  if (await store.exists()) {
    if (options.force) {
      console.log(chalk.yellow('Overwriting existing worklist...'));
    } else {
      console.log(chalk.yellow('\nWorklist already exists.\n'));
      const choice = await prompt(
        '  [o] Overwrite\n  [a] Append new items\n  [c] Cancel\n\nChoice: '
      );

      if (choice === 'c' || choice === '') {
        console.log('Cancelled.');
        return;
      }

      if (choice === 'a') {
        await appendToWorklist(store);
        return;
      }

      if (choice !== 'o') {
        console.log('Invalid choice. Cancelled.');
        return;
      }
    }
  }

  // Find latest plan for this project
  const plan = await findLatestPlan();
  if (!plan) {
    console.error(chalk.red('No plan found for this project.'));
    console.log('\nUse Claude Code plan mode to create a plan first.');
    process.exit(1);
  }

  console.log(chalk.gray(`Using plan: ${plan.path}\n`));

  // Parse plan using Claude
  const parser = new PlanParser();
  const analyzedItems = await parser.parse(plan.content);

  if (analyzedItems.length === 0) {
    console.error(chalk.red('No work items found in plan.'));
    process.exit(1);
  }

  // Convert to WorklistItems
  const items: WorklistItem[] = analyzedItems.map(item => ({
    id: item.number,
    title: item.title,
    body: item.body || '',
    dependencies: item.dependencies,
    status: 'pending' as const,
  }));

  const worklist: Worklist = {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'plan',
    items,
  };

  await store.save(worklist);

  console.log(chalk.green(`\n✓ Created worklist with ${items.length} items`));
  console.log(chalk.gray('  Run "millhouse list" to see items'));
  console.log(chalk.gray('  Run "millhouse run" to execute'));
}

async function appendToWorklist(store: WorklistStore): Promise<void> {
  const existing = await store.load();
  if (!existing) {
    console.error('Failed to load existing worklist.');
    process.exit(1);
  }

  // Find latest plan for this project
  const plan = await findLatestPlan();
  if (!plan) {
    console.error(chalk.red('No plan found for this project.'));
    console.log('\nUse Claude Code plan mode to create a plan first.');
    process.exit(1);
  }

  console.log(chalk.gray(`Using plan: ${plan.path}\n`));

  // Parse plan using Claude
  const parser = new PlanParser();
  const analyzedItems = await parser.parse(plan.content);

  if (analyzedItems.length === 0) {
    console.error(chalk.red('No work items found in plan.'));
    process.exit(1);
  }

  // Find the highest existing ID
  const maxId = Math.max(...existing.items.map(i => i.id), 0);

  // Convert to WorklistItems with new IDs
  const newItems: WorklistItem[] = analyzedItems.map((item, index) => ({
    id: maxId + index + 1,
    title: item.title,
    body: item.body || '',
    dependencies: item.dependencies.map(dep => {
      // Remap dependencies to new IDs
      const origIndex = analyzedItems.findIndex(a => a.number === dep);
      return origIndex >= 0 ? maxId + origIndex + 1 : dep;
    }),
    status: 'pending' as const,
  }));

  existing.items.push(...newItems);
  await store.save(existing);

  console.log(chalk.green(`\n✓ Appended ${newItems.length} items to worklist`));
  console.log(chalk.gray(`  Total items: ${existing.items.length}`));
}
