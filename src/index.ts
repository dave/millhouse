#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './cli/commands/init.js';
import { listCommand } from './cli/commands/list.js';
import { runCommand } from './cli/commands/run.js';
import { saveCommand } from './cli/commands/save.js';
import { loadCommand } from './cli/commands/load.js';
import { statusCommand } from './cli/commands/status.js';
import { resumeCommand } from './cli/commands/resume.js';
import { cleanCommand } from './cli/commands/clean.js';

const program = new Command();

program
  .name('millhouse')
  .description('Orchestrate parallel Claude Code instances to implement work items')
  .version('0.5.0');

program
  .command('init')
  .description('Create worklist from the latest plan in ~/.claude/plans/')
  .option('-f, --force', 'Overwrite existing worklist without prompting')
  .action(initCommand);

program
  .command('list')
  .description('Show items in the current worklist')
  .option('-v, --verbose', 'Show full item descriptions')
  .action(listCommand);

program
  .command('run')
  .description('Execute pending worklist items')
  .option('-n, --concurrency <number>', 'Number of parallel workers', '8')
  .option('-d, --display <mode>', 'Display mode: compact or detailed', 'compact')
  .option('--dry-run', 'Analyze and plan without executing')
  .option('--dangerously-skip-permissions', 'Skip permission prompts in spawned Claude instances')
  .option('--no-continue-on-error', 'Stop on first failure instead of continuing')
  .action(runCommand);

program
  .command('save')
  .description('Create GitHub issues from worklist')
  .action(saveCommand);

program
  .command('load')
  .description('Load GitHub issues into worklist')
  .argument('[issues]', 'Comma-separated issue numbers (omit to load all open issues)')
  .action(loadCommand);

program
  .command('status')
  .description('Show current run status')
  .option('--run-id <id>', 'Show status for specific run')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

program
  .command('resume')
  .description('Resume an interrupted run')
  .argument('<run-id>', 'The run ID to resume')
  .action(resumeCommand);

program
  .command('clean')
  .description('Clean up leftover worktrees, branches, and state from interrupted runs')
  .action(cleanCommand);

program.parse();
