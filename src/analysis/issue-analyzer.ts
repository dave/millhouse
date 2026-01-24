import chalk from 'chalk';
import { query } from '@anthropic-ai/claude-code';
import type { GitHubIssue, AnalyzedIssue } from '../types.js';
import { loadTemplate } from '../utils/template-loader.js';

export interface IssueAnalysisResult {
  title: string;
  description: string;
  issues: AnalyzedIssue[];
}

export class IssueAnalyzer {
  /**
   * Analyze all issues in a single Claude call to determine dependencies.
   */
  async analyzeIssues(issues: GitHubIssue[]): Promise<IssueAnalysisResult> {
    if (issues.length === 0) {
      return { title: 'No Issues', description: 'No issues to analyze.', issues: [] };
    }

    const allIssueNumbers = issues.map(i => i.number);

    // Build the issues list for the prompt
    const issuesList = issues.map(issue =>
      `### Issue #${issue.number}: ${issue.title}\n${issue.body || '(No description)'}`
    ).join('\n\n');

    const template = await loadTemplate('issue-analysis.prompt.md');
    const prompt = template.replace('{{issuesList}}', issuesList);

    const startTime = Date.now();
    console.log(chalk.blue('\nAnalyzing issues with Claude...\n'));

    try {
      const iterator = query({
        prompt,
        options: {
          cwd: process.cwd(),
          maxTurns: 20,
          // Allow read-only tools for exploring the codebase
          allowedTools: ['Read', 'Glob', 'Grep', 'Bash(git log*)', 'Bash(git show*)', 'Bash(ls*)'],
        },
      });

      let responseText = '';

      for await (const message of iterator) {
        const msg = message as unknown as Record<string, unknown>;

        if (msg.type === 'assistant') {
          const assistantMsg = msg.message as Record<string, unknown> | undefined;
          if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
            for (const block of assistantMsg.content) {
              if (typeof block === 'object' && block && 'type' in block && block.type === 'text' && 'text' in block) {
                responseText += String(block.text);
              } else if (typeof block === 'object' && block && 'type' in block && block.type === 'tool_use') {
                const toolBlock = block as { name?: string; input?: Record<string, unknown> };
                const toolName = toolBlock.name || 'unknown';
                if (toolName === 'Read') {
                  const filePath = toolBlock.input?.file_path as string || '';
                  const fileName = filePath.split('/').pop() || filePath;
                  console.log(chalk.gray(`   📖 Reading: ${fileName}`));
                } else if (toolName === 'Glob' || toolName === 'Grep') {
                  const pattern = toolBlock.input?.pattern as string || '';
                  console.log(chalk.gray(`   🔍 ${toolName}: ${pattern}`));
                } else if (toolName === 'Bash') {
                  const cmd = (toolBlock.input?.command as string || '').slice(0, 50);
                  console.log(chalk.gray(`   💻 ${cmd}${cmd.length >= 50 ? '...' : ''}`));
                } else {
                  console.log(chalk.gray(`   🔧 ${toolName}`));
                }
              }
            }
          }
        }
      }

      // Parse JSON from response - try object format first, then array
      let parsedObj: {
        title?: string;
        description?: string;
        issues: Array<{
          issueNumber: number;
          dependencies: number[];
          affectedPaths: string[];
          noWorkNeeded?: boolean;
        }>;
      };

      // Try to find JSON object first (new format)
      const objMatch = responseText.match(/\{[\s\S]*"issues"[\s\S]*\}/);
      if (objMatch) {
        parsedObj = JSON.parse(objMatch[0]);
      } else {
        // Fall back to array format (legacy)
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }
        parsedObj = {
          title: 'GitHub Issues',
          description: 'Issues loaded from GitHub.',
          issues: JSON.parse(jsonMatch[0]),
        };
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(chalk.green(`\n✓ Issues analyzed (${elapsed}s)\n`));

      // Create a map for quick lookup
      const analysisMap = new Map(parsedObj.issues.map(p => [p.issueNumber, p]));

      // Build analyzed issues
      const results: AnalyzedIssue[] = issues.map(issue => {
        const analysis = analysisMap.get(issue.number);

        // Filter dependencies to only include valid issues
        const validDeps = (analysis?.dependencies || []).filter(d =>
          allIssueNumbers.includes(d) && d !== issue.number
        );

        const noWorkNeeded = analysis?.noWorkNeeded || false;

        const analyzed: AnalyzedIssue = {
          ...issue,
          affectedPaths: analysis?.affectedPaths || [],
          dependencies: validDeps,
          analyzedAt: new Date().toISOString(),
          noWorkNeeded,
        };

        // Log each issue's analysis
        const depsStr = validDeps.length > 0
          ? `depends on ${validDeps.map(d => `#${d}`).join(', ')}`
          : 'no dependencies';
        const noWorkStr = noWorkNeeded ? ' (no work needed)' : '';
        console.log(chalk.gray(`   #${issue.number}: ${depsStr}${noWorkStr}`));

        return analyzed;
      });

      return {
        title: parsedObj.title || 'GitHub Issues',
        description: parsedObj.description || 'Issues loaded from GitHub.',
        issues: results,
      };
    } catch (error) {
      console.log(chalk.yellow(`   Claude analysis failed, falling back to pattern matching: ${error}`));
      return this.fallbackAnalysis(issues, allIssueNumbers);
    }
  }

  /**
   * Fallback to pattern matching if Claude analysis fails.
   */
  private fallbackAnalysis(issues: GitHubIssue[], allIssueNumbers: number[]): IssueAnalysisResult {
    const analyzedIssues = issues.map(issue => {
      const deps = this.extractDependencies(issue, allIssueNumbers);
      const paths = this.extractAffectedPaths(issue);

      const depsStr = deps.length > 0
        ? `depends on ${deps.map(d => `#${d}`).join(', ')}`
        : 'no dependencies';
      console.log(chalk.gray(`   #${issue.number}: ${depsStr} (pattern match)`));

      return {
        ...issue,
        affectedPaths: paths,
        dependencies: deps,
        analyzedAt: new Date().toISOString(),
      };
    });

    return {
      title: 'GitHub Issues',
      description: 'Issues loaded from GitHub.',
      issues: analyzedIssues,
    };
  }

  /**
   * Extract dependencies using pattern matching.
   */
  private extractDependencies(issue: GitHubIssue, validNumbers: number[]): number[] {
    if (!issue.body) return [];

    const dependencies = new Set<number>();
    const body = issue.body;

    const dependencyStatements = [
      /depends?\s+on\s+([^.\n]+)/gi,
      /after\s+([^.\n]+)/gi,
      /blocked\s+by\s+([^.\n]+)/gi,
      /requires?\s+([^.\n]+)/gi,
    ];

    for (const pattern of dependencyStatements) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(body)) !== null) {
        const statement = match[1];
        const issueRefs = statement.matchAll(/#(\d+)/g);
        for (const ref of issueRefs) {
          const num = parseInt(ref[1], 10);
          if (validNumbers.includes(num) && num !== issue.number) {
            dependencies.add(num);
          }
        }
      }
    }

    return Array.from(dependencies);
  }

  /**
   * Extract affected file paths from issue body.
   */
  private extractAffectedPaths(issue: GitHubIssue): string[] {
    if (!issue.body) return [];

    const paths = new Set<string>();
    const pathPattern = /`((?:src|lib|app|packages?)\/[^`]+\.[a-z]+)`/gi;
    let match: RegExpExecArray | null;

    while ((match = pathPattern.exec(issue.body)) !== null) {
      paths.add(match[1]);
    }

    return Array.from(paths);
  }
}
