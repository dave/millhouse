import { query } from '@anthropic-ai/claude-code';
import type { GitHubIssue, AnalyzedIssue } from '../types.js';

const ANALYSIS_PROMPT = `Analyze this GitHub issue and extract dependency information.

Issue #{{number}}: {{title}}

{{body}}

---

I need you to analyze this issue and respond with ONLY a JSON object (no markdown, no explanation):
{
  "affectedPaths": ["src/path/to/file.ts", "src/directory/"],
  "dependencies": [123, 456]
}

Rules:
- affectedPaths: List file paths or directories this issue likely modifies
- dependencies: List issue numbers this MUST be completed BEFORE this issue can start
- Look for explicit "depends on #X", "after #X", or "blocked by #X" mentions
- Only include dependencies from this list of valid issues: {{validIssues}}
- If no dependencies, use empty array: []
- Respond with ONLY the JSON, nothing else`;

export class IssueAnalyzer {
  /**
   * Analyze a single issue for dependencies and affected paths using Claude Code.
   */
  async analyzeIssue(issue: GitHubIssue, allIssueNumbers: number[]): Promise<AnalyzedIssue> {
    const prompt = ANALYSIS_PROMPT
      .replace('{{number}}', String(issue.number))
      .replace('{{title}}', issue.title)
      .replace('{{body}}', issue.body || '(No description)')
      .replace('{{validIssues}}', allIssueNumbers.filter(n => n !== issue.number).join(', ') || 'none');

    try {
      // Use Claude Code to analyze the issue
      const iterator = query({
        prompt,
        options: {
          maxTurns: 1,
          allowedTools: [], // No tools needed, just analysis
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
              }
            }
          }
        }
      }

      // Parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        affectedPaths: string[];
        dependencies: number[];
      };

      // Filter dependencies to only include issues in our set
      const validDependencies = (parsed.dependencies || []).filter(d =>
        allIssueNumbers.includes(d) && d !== issue.number
      );

      return {
        ...issue,
        affectedPaths: parsed.affectedPaths || [],
        dependencies: validDependencies,
        analyzedAt: new Date().toISOString(),
      };
    } catch (error) {
      // If analysis fails, fall back to text pattern matching
      console.warn(`Claude analysis failed for #${issue.number}, using text patterns: ${error}`);

      return {
        ...issue,
        affectedPaths: [],
        dependencies: this.extractExplicitDependencies(issue, allIssueNumbers),
        analyzedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Analyze multiple issues sequentially (Claude Code sessions are heavyweight).
   */
  async analyzeIssues(issues: GitHubIssue[]): Promise<AnalyzedIssue[]> {
    const allIssueNumbers = issues.map(i => i.number);
    const results: AnalyzedIssue[] = [];

    for (const issue of issues) {
      const analyzed = await this.analyzeIssue(issue, allIssueNumbers);
      results.push(analyzed);
    }

    return results;
  }

  /**
   * Extract explicit dependencies from issue body (fallback when Claude fails).
   */
  private extractExplicitDependencies(issue: GitHubIssue, validNumbers: number[]): number[] {
    if (!issue.body) return [];

    const dependencies = new Set<number>();

    // Look for "depends on #X" patterns
    const dependsPattern = /depends?\s+on\s+#(\d+)/gi;
    let match: RegExpExecArray | null;

    while ((match = dependsPattern.exec(issue.body)) !== null) {
      const num = parseInt(match[1], 10);
      if (validNumbers.includes(num) && num !== issue.number) {
        dependencies.add(num);
      }
    }

    // Look for "after #X" patterns
    const afterPattern = /after\s+#(\d+)/gi;
    while ((match = afterPattern.exec(issue.body)) !== null) {
      const num = parseInt(match[1], 10);
      if (validNumbers.includes(num) && num !== issue.number) {
        dependencies.add(num);
      }
    }

    // Look for "blocked by #X" patterns
    const blockedPattern = /blocked\s+by\s+#(\d+)/gi;
    while ((match = blockedPattern.exec(issue.body)) !== null) {
      const num = parseInt(match[1], 10);
      if (validNumbers.includes(num) && num !== issue.number) {
        dependencies.add(num);
      }
    }

    return Array.from(dependencies);
  }
}
