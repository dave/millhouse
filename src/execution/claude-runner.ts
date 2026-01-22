import { query } from '@anthropic-ai/claude-code';
import { execSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalyzedIssue, Config } from '../types.js';

// ES modules equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RunResult {
  success: boolean;
  commits: string[];
  error?: string;
  output?: string;
}

export class ClaudeRunner {
  private promptTemplate: string | null = null;

  constructor(_config: Config) {
    // Config can be used for future options like maxBudget
  }

  /**
   * Load the implementation prompt template.
   */
  private async loadPromptTemplate(): Promise<string> {
    if (this.promptTemplate) {
      return this.promptTemplate;
    }

    // Try to load from templates directory
    const templatePaths = [
      path.join(process.cwd(), 'templates', 'implementation.prompt.md'),
      path.join(__dirname, '..', '..', 'templates', 'implementation.prompt.md'),
    ];

    for (const templatePath of templatePaths) {
      try {
        this.promptTemplate = await fs.readFile(templatePath, 'utf-8');
        return this.promptTemplate;
      } catch {
        // Try next path
      }
    }

    // Fall back to default template
    this.promptTemplate = DEFAULT_PROMPT_TEMPLATE;
    return this.promptTemplate;
  }

  /**
   * Build the prompt for Claude to implement an issue.
   */
  async buildPrompt(issue: AnalyzedIssue, runId: string): Promise<string> {
    const template = await this.loadPromptTemplate();

    return template
      .replace(/\{\{issue\.number\}\}/g, String(issue.number))
      .replace(/\{\{issue\.title\}\}/g, issue.title)
      .replace(/\{\{issue\.body\}\}/g, issue.body || '(No description)')
      .replace(/\{\{runId\}\}/g, runId)
      .replace(/\{\{affectedPaths\}\}/g, issue.affectedPaths.join(', ') || 'Not specified');
  }

  /**
   * Run Claude to implement an issue in the given worktree.
   */
  async run(
    issue: AnalyzedIssue,
    runId: string,
    worktreePath: string
  ): Promise<RunResult> {
    const prompt = await this.buildPrompt(issue, runId);
    const issueTag = `#${issue.number}`;

    try {
      // Get commits before running Claude
      const commitsBefore = this.getCommitHashes(worktreePath);

      // Run Claude using the Agent SDK
      const iterator = query({
        prompt,
        options: {
          cwd: worktreePath,
          model: 'claude-sonnet-4-20250514',
          permissionMode: 'acceptEdits',
          maxTurns: 50,
        },
      });

      // Collect all messages
      const messages: string[] = [];
      let hasError = false;
      let errorMessage = '';

      for await (const message of iterator) {
        // Handle different message types from the SDK using type guards
        const msg = message as unknown as Record<string, unknown>;

        if (msg.type === 'assistant') {
          // Extract text content from assistant messages
          const assistantMsg = msg.message as Record<string, unknown> | undefined;
          if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
            for (const block of assistantMsg.content) {
              if (typeof block === 'object' && block && 'type' in block && block.type === 'text' && 'text' in block) {
                const text = String(block.text);
                messages.push(text);
                // Log a preview of what Claude is saying
                const preview = text.slice(0, 100).replace(/\n/g, ' ');
                console.log(`   [${issueTag}] ${preview}${text.length > 100 ? '...' : ''}`);
              } else if (typeof block === 'object' && block && 'type' in block && block.type === 'tool_use') {
                const toolBlock = block as { name?: string; input?: Record<string, unknown> };
                const toolName = toolBlock.name || 'unknown';
                // Log tool usage with relevant details
                if (toolName === 'Edit' || toolName === 'Write') {
                  const filePath = toolBlock.input?.file_path as string || '';
                  const fileName = filePath.split('/').pop() || filePath;
                  console.log(`   [${issueTag}] 📝 ${toolName}: ${fileName}`);
                } else if (toolName === 'Read') {
                  const filePath = toolBlock.input?.file_path as string || '';
                  const fileName = filePath.split('/').pop() || filePath;
                  console.log(`   [${issueTag}] 📖 Reading: ${fileName}`);
                } else if (toolName === 'Bash') {
                  const cmd = (toolBlock.input?.command as string || '').slice(0, 50);
                  console.log(`   [${issueTag}] 💻 ${cmd}${cmd.length >= 50 ? '...' : ''}`);
                } else if (toolName === 'Glob' || toolName === 'Grep') {
                  const pattern = toolBlock.input?.pattern as string || '';
                  console.log(`   [${issueTag}] 🔍 ${toolName}: ${pattern}`);
                } else {
                  console.log(`   [${issueTag}] 🔧 ${toolName}`);
                }
              }
            }
          }
        } else if (msg.type === 'result') {
          const subtype = msg.subtype as string | undefined;
          if (subtype === 'error_during_execution' || subtype === 'error_max_turns') {
            hasError = true;
            errorMessage = (msg.error as string) || 'Claude execution failed';
          }
        }
      }

      if (hasError) {
        return {
          success: false,
          commits: [],
          error: errorMessage,
          output: messages.join('\n'),
        };
      }

      // Commit any uncommitted changes Claude made
      // (Claude may not have committed due to permission restrictions)
      const newCommits = await this.commitChanges(worktreePath, issue.number, commitsBefore);

      return {
        success: true,
        commits: newCommits,
        output: messages.join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        commits: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all commit hashes in the worktree.
   */
  private getCommitHashes(worktreePath: string): string[] {
    try {
      const output = execSync('git log --format=%H', {
        cwd: worktreePath,
        encoding: 'utf-8',
      });
      return output.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Commit any uncommitted changes in the worktree.
   * Returns the new commit hashes.
   */
  private async commitChanges(
    worktreePath: string,
    issueNumber: number,
    commitsBefore: string[]
  ): Promise<string[]> {
    try {
      // Check if there are uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: worktreePath,
        encoding: 'utf-8',
      }).trim();

      if (status) {
        // There are uncommitted changes - commit them
        console.log(`   [#${issueNumber}] 📦 Committing changes...`);

        execSync('git add -A', { cwd: worktreePath });
        execSync(
          `git commit -m "feat: implement issue #${issueNumber}\n\nFixes #${issueNumber}"`,
          { cwd: worktreePath }
        );
      }

      // Get commits after
      const commitsAfter = this.getCommitHashes(worktreePath);
      return commitsAfter.filter(c => !commitsBefore.includes(c));
    } catch (error) {
      // If commit fails, still return any commits Claude may have made
      const commitsAfter = this.getCommitHashes(worktreePath);
      return commitsAfter.filter(c => !commitsBefore.includes(c));
    }
  }
}

const DEFAULT_PROMPT_TEMPLATE = `# Your Task

Implement GitHub issue #{{issue.number}}: {{issue.title}}

## Issue Description
{{issue.body}}

## Likely Affected Files
{{affectedPaths}}

## Instructions

1. **Understand**: Read the relevant code and understand the context
2. **Implement**: Make the necessary changes to resolve this issue
3. **Test**: Run existing tests and add new tests if appropriate
4. **Commit**: Create meaningful commits with clear messages
   - Include "Fixes #{{issue.number}}" in the final commit message

## Important Rules
- You are working in a git worktree on branch \`millhouse/run-{{runId}}\`
- Do NOT create a pull request - the orchestrator handles that
- If you encounter blocking issues, explain what's needed and stop
- Your changes will be merged with other parallel tasks
- Focus only on this issue - don't fix unrelated problems
- Keep changes minimal and focused

## Git Commands
- Use \`git add <files>\` to stage specific files
- Use \`git commit -m "message"\` to commit
- Do NOT use \`git push\` - the orchestrator handles that

## When You're Done
Summarize what you changed and any important notes for reviewers.
`;
