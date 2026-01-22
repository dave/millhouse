import chalk from 'chalk';
import type { GitHubClient } from './client.js';
import type { GitHubIssue } from '../types.js';

export class IssueDiscoverer {
  constructor(private client: GitHubClient) {}

  /**
   * Discovers all issues starting from the given issue numbers.
   * If recursive is true, follows linked issues in descriptions.
   */
  async discover(issueNumbers: number[], recursive: boolean): Promise<GitHubIssue[]> {
    const discovered = new Map<number, GitHubIssue>();
    const toProcess = new Set(issueNumbers);
    const processed = new Set<number>();

    console.log(chalk.gray(`   Starting with issues: ${issueNumbers.map(n => `#${n}`).join(', ')}`));
    if (recursive) {
      console.log(chalk.gray(`   Recursive mode: will follow linked issues`));
    }

    while (toProcess.size > 0) {
      const batch = Array.from(toProcess);
      toProcess.clear();

      console.log(chalk.gray(`   Fetching: ${batch.map(n => `#${n}`).join(', ')}`));

      // Fetch issues in parallel
      const issues = await this.client.getIssues(batch);

      for (const issue of issues) {
        if (discovered.has(issue.number)) continue;

        discovered.set(issue.number, issue);
        processed.add(issue.number);

        console.log(chalk.gray(`   Found #${issue.number}: ${issue.title}`));

        // If recursive, find linked issues
        if (recursive && issue.body) {
          const linkedIssues = this.parseLinkedIssues(issue.body);
          const newLinked = linkedIssues.filter(n => !processed.has(n) && !discovered.has(n));
          if (newLinked.length > 0) {
            console.log(chalk.gray(`   └─ Links to: ${newLinked.map(n => `#${n}`).join(', ')}`));
          }
          for (const linkedNumber of newLinked) {
            toProcess.add(linkedNumber);
          }
        }
      }
    }

    return Array.from(discovered.values());
  }

  /**
   * Parse issue body for linked issue references.
   * Handles:
   * - Direct references: #123
   * - Task lists: - [ ] #123
   * - URLs: github.com/owner/repo/issues/123
   */
  private parseLinkedIssues(body: string): number[] {
    const issueNumbers = new Set<number>();

    // Match #123 patterns (not in URLs)
    const hashPattern = /(?:^|[^/])#(\d+)/g;
    let match: RegExpExecArray | null;

    while ((match = hashPattern.exec(body)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num < 1000000) {
        issueNumbers.add(num);
      }
    }

    // Match task list items: - [ ] #123 or - [x] #123
    const taskListPattern = /- \[[ x]\] #(\d+)/gi;
    while ((match = taskListPattern.exec(body)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num < 1000000) {
        issueNumbers.add(num);
      }
    }

    // Match GitHub issue URLs for the same repo
    const urlPattern = /github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/g;
    while ((match = urlPattern.exec(body)) !== null) {
      const num = parseInt(match[1], 10);
      if (num > 0 && num < 1000000) {
        issueNumbers.add(num);
      }
    }

    return Array.from(issueNumbers);
  }
}
