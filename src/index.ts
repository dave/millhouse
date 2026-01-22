#!/usr/bin/env node

import { Command } from 'commander';
import { runCommand } from './cli/commands/run.js';
import { statusCommand } from './cli/commands/status.js';
import { resumeCommand } from './cli/commands/resume.js';

const program = new Command();

program
  .name('millhouse')
  .description('Orchestrates multiple parallel Claude Code instances to work on GitHub issues')
  .version('0.1.0');

program
  .command('run')
  .description('Start working on GitHub issues')
  .option('-i, --issue <number>', 'Root issue number (recursively includes linked issues)')
  .option('--issues <numbers>', 'Comma-separated list of specific issue numbers')
  .option('-n, --concurrency <number>', 'Number of parallel workers', '3')
  .option('--dry-run', 'Analyze and plan without executing')
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

program.parse();
