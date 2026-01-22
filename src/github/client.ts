import { Octokit } from '@octokit/rest';
import { execSync } from 'node:child_process';
import type { GitHubIssue } from '../types.js';

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    // Get token from gh CLI or environment
    const token = this.getGitHubToken();
    this.octokit = new Octokit({ auth: token });

    // Get repo info from git remote
    const { owner, repo } = this.getRepoInfo();
    this.owner = owner;
    this.repo = repo;
  }

  private getGitHubToken(): string {
    // First try environment variable
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN;
    }

    // Try gh CLI
    try {
      const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
      return token;
    } catch {
      throw new Error('No GitHub token found. Run "gh auth login" or set GITHUB_TOKEN');
    }
  }

  private getRepoInfo(): { owner: string; repo: string } {
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();

      // Parse GitHub URL (SSH or HTTPS)
      const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
      if (sshMatch) {
        return { owner: sshMatch[1], repo: sshMatch[2] };
      }

      const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
      if (httpsMatch) {
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
      }

      throw new Error(`Cannot parse GitHub URL: ${remoteUrl}`);
    } catch (error) {
      throw new Error(`Failed to get repo info: ${error instanceof Error ? error.message : error}`);
    }
  }

  get repoOwner(): string {
    return this.owner;
  }

  get repoName(): string {
    return this.repo;
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const response = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    return {
      number: response.data.number,
      title: response.data.title,
      body: response.data.body ?? null,
      state: response.data.state as 'open' | 'closed',
      labels: response.data.labels.map(l => (typeof l === 'string' ? l : l.name || '')),
      url: response.data.url,
      htmlUrl: response.data.html_url,
    };
  }

  async getIssues(issueNumbers: number[]): Promise<GitHubIssue[]> {
    const promises = issueNumbers.map(n => this.getIssue(n));
    return Promise.all(promises);
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.addLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels,
    });
  }

  async removeLabel(issueNumber: number, label: string): Promise<void> {
    try {
      await this.octokit.issues.removeLabel({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        name: label,
      });
    } catch {
      // Label might not exist, ignore
    }
  }

  async setLabels(issueNumber: number, labels: string[]): Promise<void> {
    await this.octokit.issues.setLabels({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      labels,
    });
  }

  async createLabel(name: string, color: string, description?: string): Promise<void> {
    try {
      await this.octokit.issues.createLabel({
        owner: this.owner,
        repo: this.repo,
        name,
        color,
        description,
      });
    } catch {
      // Label might already exist
    }
  }

  async addComment(issueNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
  }

  async createPullRequest(options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }): Promise<string> {
    const response = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: options.title,
      body: options.body,
      head: options.head,
      base: options.base,
      draft: options.draft ?? true,
    });

    return response.data.html_url;
  }
}
