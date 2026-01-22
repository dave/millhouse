#!/usr/bin/env node

import { Command } from 'commander';
import { runCommand } from './cli/commands/run.js';
import { statusCommand } from './cli/commands/status.js';
import { resumeCommand } from './cli/commands/resume.js';
import { setupCommand } from './cli/commands/setup.js';
import { cleanCommand } from './cli/commands/clean.js';

const program = new Command();

program
  .name('millhouse')
  .description('Orchestrates multiple parallel Claude Code instances to work on GitHub issues or plan files')
  .version('0.1.0');

program
  .command('run')
  .description('Start working on GitHub issues or a plan file')
  .option('-i, --issue <number>', 'Root issue number (recursively includes linked issues)')
  .option('--issues <numbers>', 'Comma-separated list of specific issue numbers')
  .option('-p, --plan [path]', 'Path to a plan file (omit to use most recent)')
  .option('-n, --concurrency <number>', 'Number of parallel workers', '8')
  .option('-d, --display <mode>', 'Display mode: compact or detailed', 'compact')
  .option('--dry-run', 'Analyze and plan without executing')
  .option('--dangerously-skip-permissions', 'Skip permission prompts in spawned Claude instances')
  .action(runCommand);

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
  .command('setup')
  .description('Install Claude Code slash commands')
  .option('-g, --global', 'Install to ~/.claude/commands/ instead of ./.claude/commands/')
  .action(setupCommand);

program
  .command('clean')
  .description('Clean up leftover worktrees, branches, and state from interrupted runs')
  .action(cleanCommand);

program.parse();
