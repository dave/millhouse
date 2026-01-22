import chalk from 'chalk';
import { query } from '@anthropic-ai/claude-code';
import type { AnalyzedIssue } from '../types.js';

const PLAN_ANALYSIS_PROMPT = `Analyze this plan and break it into discrete, implementable work items.

## Plan

{{plan}}

---

## Your Task

Break this plan into discrete work items that can be implemented independently (but may have dependencies on each other).

For each work item, provide:
1. **id**: Sequential number starting from 1
2. **title**: Short descriptive title
3. **body**: Full implementation details including:
   - What to create/modify
   - Specific file paths
   - Function signatures or interfaces
   - Testing instructions
   - Acceptance criteria
4. **dependencies**: IDs of work items that MUST be completed before this one

Respond with ONLY a JSON array (no markdown, no explanation):
[
  {
    "id": 1,
    "title": "Initialize project",
    "body": "Create the project structure...\\n\\n## Implementation\\n...",
    "dependencies": []
  },
  {
    "id": 2,
    "title": "Create utilities",
    "body": "Create utility functions...\\n\\n**Depends on #1**\\n\\n## Implementation\\n...",
    "dependencies": [1]
  }
]

Rules:
- Each work item should be self-contained with all context needed to implement it
- Include "**Depends on #N**" in the body text for any dependencies
- Work items should be small enough to implement in one session
- Include specific file paths, function signatures, and acceptance criteria
- Respond with ONLY valid JSON, nothing else`;

export class PlanParser {
  /**
   * Parse a plan into discrete work items with dependencies.
   */
  async parse(planContent: string): Promise<AnalyzedIssue[]> {
    const prompt = PLAN_ANALYSIS_PROMPT.replace('{{plan}}', planContent);

    console.log(chalk.gray('   Sending plan to Claude for analysis...'));

    try {
      const iterator = query({
        prompt,
        options: {
          maxTurns: 1,
          allowedTools: [],
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

      // Parse JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: number;
        title: string;
        body: string;
        dependencies: number[];
      }>;

      const allIds = parsed.map(p => p.id);

      // Convert to AnalyzedIssue format
      const results: AnalyzedIssue[] = parsed.map(item => {
        // Filter dependencies to only include valid IDs
        const validDeps = item.dependencies.filter(d =>
          allIds.includes(d) && d !== item.id
        );

        const depsStr = validDeps.length > 0
          ? `depends on ${validDeps.map(d => `#${d}`).join(', ')}`
          : 'no dependencies';
        console.log(chalk.gray(`   #${item.id}: ${item.title} (${depsStr})`));

        return {
          number: item.id,
          title: item.title,
          body: item.body,
          state: 'open' as const,
          labels: [],
          url: '',
          htmlUrl: '',
          affectedPaths: [],
          dependencies: validDeps,
          analyzedAt: new Date().toISOString(),
        };
      });

      return results;
    } catch (error) {
      throw new Error(`Failed to parse plan: ${error instanceof Error ? error.message : error}`);
    }
  }
}
