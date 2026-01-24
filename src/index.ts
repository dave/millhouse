#!/usr/bin/env node

import { Command } from 'commander';
import { runPlanCommand, runIssuesCommand } from './cli/commands/run.js';
import { statusCommand } from './cli/commands/status.js';
import { resumeCommand } from './cli/commands/resume.js';
import { setupCommand } from './cli/commands/setup.js';
import { cleanCommand } from './cli/commands/clean.js';

const program = new Command();

program
  .name('millhouse')
  .description('Orchestrates multiple parallel Claude Code instances to work on GitHub issues or plan files')
  .version('0.1.0')
  .enablePositionalOptions();

// Main run command - defaults to plan mode
const runCmd = program
  .command('run')
  .description('Execute a JSON plan (default) or GitHub issues')
  .argument('[name]', 'Plan name (loads millhouse-plan-{name}.json, or millhouse-plan.json if omitted)')
  .option('-n, --concurrency <number>', 'Number of parallel workers', '8')
  .option('-d, --display <mode>', 'Display mode: compact or detailed', 'compact')
  .option('--dry-run', 'Analyze and plan without executing')
  .option('--no-scan', 'Skip project structure scanning')
  .option('--dangerously-skip-permissions', 'Skip permission prompts in spawned Claude instances')
  .enablePositionalOptions()
  .passThroughOptions()
  .action(runPlanCommand);

// Subcommand for GitHub issues mode
runCmd
  .command('issues')
  .description('Execute GitHub issues')
  .argument('[numbers]', 'Comma-separated issue numbers (omit to run all open issues)')
  .option('-n, --concurrency <number>', 'Number of parallel workers', '8')
  .option('-d, --display <mode>', 'Display mode: compact or detailed', 'compact')
  .option('--dry-run', 'Analyze and plan without executing')
  .option('--no-scan', 'Skip project structure scanning')
  .option('--dangerously-skip-permissions', 'Skip permission prompts in spawned Claude instances')
  .action(runIssuesCommand);

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
