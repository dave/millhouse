import chalk from 'chalk';
import readline from 'node:readline';
import type { AnalyzedIssue } from '../types.js';

export type IssueState = 'queued' | 'blocked' | 'running' | 'completed' | 'failed';

interface IssueProgress {
  number: number;
  title: string;
  state: IssueState;
  latestMessage: string;
  blockedBy: number[];
}

export type ProgressEvent =
  | { type: 'issue-started'; issueNumber: number }
  | { type: 'issue-message'; issueNumber: number; message: string }
  | { type: 'issue-completed'; issueNumber: number }
  | { type: 'issue-failed'; issueNumber: number; error: string }
  | { type: 'issue-blocked'; issueNumber: number; blockedBy: number[] }
  | { type: 'issue-unblocked'; issueNumber: number };

export class ProgressDisplay {
  private issues: Map<number, IssueProgress> = new Map();
  private issueOrder: number[] = [];
  private compactMode = true;
  private lastRenderLines = 0;
  private keyHandler: ((key: Buffer) => void) | null = null;
  private isRunning = false;

  constructor() {}

  /**
   * Initialize with the list of issues.
   */
  initialize(issues: AnalyzedIssue[]): void {
    this.issues.clear();
    this.issueOrder = [];

    for (const issue of issues) {
      const blockedBy = issue.dependencies.filter(dep =>
        issues.some(i => i.number === dep)
      );

      this.issues.set(issue.number, {
        number: issue.number,
        title: issue.title,
        state: blockedBy.length > 0 ? 'blocked' : 'queued',
        latestMessage: blockedBy.length > 0
          ? `Waiting for ${blockedBy.map(n => `#${n}`).join(', ')}`
          : 'Queued',
        blockedBy,
      });
      this.issueOrder.push(issue.number);
    }
  }

  /**
   * Start listening for keyboard input to toggle views.
   */
  start(): void {
    this.isRunning = true;

    // Enable raw mode for keyboard input
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin);
      process.stdin.setRawMode(true);

      this.keyHandler = (key: Buffer) => {
        const char = key.toString();

        // Ctrl+C - exit
        if (char === '\u0003') {
          this.stop();
          process.emit('SIGINT', 'SIGINT');
          return;
        }

        // 'v' or 'V' - toggle view
        if (char === 'v' || char === 'V') {
          this.toggleView();
        }
      };

      process.stdin.on('data', this.keyHandler);
    }

    // Initial render
    if (this.compactMode) {
      console.log(chalk.gray('Press [v] to toggle detailed view\n'));
      this.render();
    }
  }

  /**
   * Stop the display.
   */
  stop(): void {
    this.isRunning = false;

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      if (this.keyHandler) {
        process.stdin.removeListener('data', this.keyHandler);
        this.keyHandler = null;
      }
    }

    // Clear and render final state
    if (this.compactMode) {
      this.clearLines();
      this.renderFinal();
    }
  }

  /**
   * Toggle between compact and detailed view.
   */
  private toggleView(): void {
    if (this.compactMode) {
      // Switching to detailed - clear compact view
      this.clearLines();
      console.log(chalk.gray('Switched to detailed view. Press [v] to switch back.\n'));
    } else {
      // Switching to compact - start fresh
      console.log(chalk.gray('\nSwitched to compact view. Press [v] to switch back.\n'));
    }

    this.compactMode = !this.compactMode;

    if (this.compactMode) {
      this.render();
    }
  }

  /**
   * Handle a progress event.
   */
  handleEvent(event: ProgressEvent): void {
    const issue = this.issues.get(event.issueNumber);
    if (!issue) return;

    switch (event.type) {
      case 'issue-started':
        issue.state = 'running';
        issue.latestMessage = 'Starting...';
        break;

      case 'issue-message':
        issue.latestMessage = this.truncateMessage(event.message);
        break;

      case 'issue-completed':
        issue.state = 'completed';
        issue.latestMessage = 'Finished!';
        break;

      case 'issue-failed':
        issue.state = 'failed';
        issue.latestMessage = `Failed: ${this.truncateMessage(event.error)}`;
        break;

      case 'issue-blocked':
        issue.state = 'blocked';
        issue.blockedBy = event.blockedBy;
        issue.latestMessage = `Waiting for ${event.blockedBy.map(n => `#${n}`).join(', ')}`;
        break;

      case 'issue-unblocked':
        if (issue.state === 'blocked') {
          issue.state = 'queued';
          issue.blockedBy = [];
          issue.latestMessage = 'Ready';
        }
        break;
    }

    if (this.compactMode && this.isRunning) {
      this.render();
    } else if (!this.compactMode && this.isRunning) {
      this.renderDetailedEvent(event);
    }
  }

  /**
   * Log a message in detailed mode (no-op in compact mode).
   */
  logDetailed(issueNumber: number, message: string): void {
    if (!this.compactMode && this.isRunning) {
      console.log(`   [#${issueNumber}] ${message}`);
    }

    // Also update the latest message for compact mode
    const issue = this.issues.get(issueNumber);
    if (issue) {
      issue.latestMessage = this.truncateMessage(message);
      if (this.compactMode && this.isRunning) {
        this.render();
      }
    }
  }

  /**
   * Truncate a message to fit on one line.
   */
  private truncateMessage(message: string): string {
    // Remove newlines and trim
    const clean = message.replace(/\n/g, ' ').trim();
    const maxLen = 60;
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 3) + '...';
  }

  /**
   * Clear previously rendered lines.
   */
  private clearLines(): void {
    if (this.lastRenderLines > 0) {
      // Move cursor up and clear each line
      process.stdout.write(`\x1B[${this.lastRenderLines}A`);
      for (let i = 0; i < this.lastRenderLines; i++) {
        process.stdout.write('\x1B[2K\n');
      }
      process.stdout.write(`\x1B[${this.lastRenderLines}A`);
    }
  }

  /**
   * Render the compact view.
   */
  private render(): void {
    this.clearLines();

    const lines: string[] = [];

    for (const issueNumber of this.issueOrder) {
      const issue = this.issues.get(issueNumber);
      if (!issue) continue;

      const stateIcon = this.getStateIcon(issue.state);
      const stateColor = this.getStateColor(issue.state);
      const titleShort = issue.title.length > 30
        ? issue.title.slice(0, 27) + '...'
        : issue.title;

      const line = `${stateIcon} ${stateColor(`#${issue.number}`)} ${chalk.gray(titleShort)} ${chalk.dim('│')} ${issue.latestMessage}`;
      lines.push(line);
    }

    const output = lines.join('\n') + '\n';
    process.stdout.write(output);
    this.lastRenderLines = lines.length;
  }

  /**
   * Render final summary after stopping.
   */
  private renderFinal(): void {
    console.log('');
    for (const issueNumber of this.issueOrder) {
      const issue = this.issues.get(issueNumber);
      if (!issue) continue;

      const stateIcon = this.getStateIcon(issue.state);
      const stateColor = this.getStateColor(issue.state);

      console.log(`${stateIcon} ${stateColor(`#${issue.number}`)} ${issue.title}`);
    }
    console.log('');
  }

  /**
   * Render a single event in detailed mode.
   */
  private renderDetailedEvent(event: ProgressEvent): void {
    switch (event.type) {
      case 'issue-started':
        console.log(chalk.cyan(`   ▶ Started: #${event.issueNumber}`));
        break;
      case 'issue-completed':
        console.log(chalk.green(`   ✓ Completed: #${event.issueNumber}`));
        break;
      case 'issue-failed':
        console.log(chalk.red(`   ✗ Failed: #${event.issueNumber} - ${event.error}`));
        break;
      case 'issue-unblocked':
        console.log(chalk.cyan(`   ⏳ Unblocked: #${event.issueNumber}`));
        break;
    }
  }

  /**
   * Get the icon for a state.
   */
  private getStateIcon(state: IssueState): string {
    switch (state) {
      case 'queued': return chalk.gray('○');
      case 'blocked': return chalk.yellow('◷');
      case 'running': return chalk.blue('●');
      case 'completed': return chalk.green('✓');
      case 'failed': return chalk.red('✗');
    }
  }

  /**
   * Get the color function for a state.
   */
  private getStateColor(state: IssueState): (s: string) => string {
    switch (state) {
      case 'queued': return chalk.gray;
      case 'blocked': return chalk.yellow;
      case 'running': return chalk.blue;
      case 'completed': return chalk.green;
      case 'failed': return chalk.red;
    }
  }
}
