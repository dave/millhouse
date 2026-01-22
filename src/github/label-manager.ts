import type { GitHubClient } from './client.js';
import { MILLHOUSE_LABELS, type MillhouseLabel, type TaskStatus } from '../types.js';

const LABEL_COLORS: Record<MillhouseLabel, string> = {
  [MILLHOUSE_LABELS.QUEUED]: 'c5def5',      // Light blue
  [MILLHOUSE_LABELS.IN_PROGRESS]: '0e8a16', // Green
  [MILLHOUSE_LABELS.BLOCKED]: 'fbca04',     // Yellow
  [MILLHOUSE_LABELS.FAILED]: 'd73a4a',      // Red
  [MILLHOUSE_LABELS.DONE]: '6f42c1',        // Purple
};

const LABEL_DESCRIPTIONS: Record<MillhouseLabel, string> = {
  [MILLHOUSE_LABELS.QUEUED]: 'Issue is queued for Millhouse execution',
  [MILLHOUSE_LABELS.IN_PROGRESS]: 'Millhouse is actively working on this issue',
  [MILLHOUSE_LABELS.BLOCKED]: 'Waiting for dependency to complete',
  [MILLHOUSE_LABELS.FAILED]: 'Millhouse execution failed',
  [MILLHOUSE_LABELS.DONE]: 'Millhouse completed work on this issue',
};

const STATUS_TO_LABEL: Record<TaskStatus, MillhouseLabel | null> = {
  'queued': MILLHOUSE_LABELS.QUEUED,
  'blocked': MILLHOUSE_LABELS.BLOCKED,
  'ready': MILLHOUSE_LABELS.QUEUED,
  'in-progress': MILLHOUSE_LABELS.IN_PROGRESS,
  'completed': MILLHOUSE_LABELS.DONE,
  'failed': MILLHOUSE_LABELS.FAILED,
};

export class LabelManager {
  constructor(private client: GitHubClient) {}

  /**
   * Ensure all Millhouse labels exist in the repository.
   */
  async ensureLabelsExist(): Promise<void> {
    const labelPromises = Object.values(MILLHOUSE_LABELS).map(label =>
      this.client.createLabel(
        label,
        LABEL_COLORS[label],
        LABEL_DESCRIPTIONS[label]
      )
    );

    await Promise.all(labelPromises);
  }

  /**
   * Remove all Millhouse labels from an issue.
   */
  async clearMillhouseLabels(issueNumber: number): Promise<void> {
    const removePromises = Object.values(MILLHOUSE_LABELS).map(label =>
      this.client.removeLabel(issueNumber, label)
    );

    await Promise.all(removePromises);
  }

  /**
   * Set the Millhouse status label for an issue.
   * Removes any existing Millhouse labels first.
   */
  async setStatus(issueNumber: number, status: TaskStatus): Promise<void> {
    const label = STATUS_TO_LABEL[status];

    // Remove all Millhouse labels first
    await this.clearMillhouseLabels(issueNumber);

    // Add the new label if applicable
    if (label) {
      await this.client.addLabels(issueNumber, [label]);
    }
  }

  /**
   * Set multiple issues to a status.
   */
  async setStatusBatch(issueNumbers: number[], status: TaskStatus): Promise<void> {
    await Promise.all(issueNumbers.map(n => this.setStatus(n, status)));
  }

  /**
   * Mark an issue as queued.
   */
  async markQueued(issueNumber: number): Promise<void> {
    await this.setStatus(issueNumber, 'queued');
  }

  /**
   * Mark an issue as in progress.
   */
  async markInProgress(issueNumber: number): Promise<void> {
    await this.setStatus(issueNumber, 'in-progress');
  }

  /**
   * Mark an issue as blocked.
   */
  async markBlocked(issueNumber: number): Promise<void> {
    await this.setStatus(issueNumber, 'blocked');
  }

  /**
   * Mark an issue as failed.
   */
  async markFailed(issueNumber: number): Promise<void> {
    await this.setStatus(issueNumber, 'failed');
  }

  /**
   * Mark an issue as done.
   */
  async markDone(issueNumber: number): Promise<void> {
    await this.setStatus(issueNumber, 'completed');
  }
}
