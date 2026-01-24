import chalk from 'chalk';
import { query } from '@anthropic-ai/claude-code';
import type { AnalyzedIssue } from '../types.js';
import { loadTemplate } from '../utils/template-loader.js';

export class PlanParser {
  /**
   * Parse a plan into discrete work items with dependencies.
   * Claude has access to the codebase to understand existing patterns.
   */
  async parse(planContent: string): Promise<AnalyzedIssue[]> {
    const template = await loadTemplate('plan-analysis.prompt.md');
    const prompt = template.replace('{{plan}}', planContent);

    const startTime = Date.now();
    console.log(chalk.blue('Analyzing plan...\n'));

    try {
      const iterator = query({
        prompt,
        options: {
          cwd: process.cwd(),
          maxTurns: 20,  // Allow multiple turns for exploration
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
                // Log tool usage for feedback
                const toolBlock = block as { name?: string; input?: Record<string, unknown> };
                const toolName = toolBlock.name || 'unknown';

                if (toolName === 'Read') {
                  const filePath = toolBlock.input?.file_path as string || '';
                  const fileName = filePath.split('/').pop() || filePath;
                  console.log(chalk.gray(`   📖 Reading: ${fileName}`));
                } else if (toolName === 'Glob') {
                  const pattern = toolBlock.input?.pattern as string || '';
                  console.log(chalk.gray(`   🔍 Glob: ${pattern}`));
                } else if (toolName === 'Grep') {
                  const pattern = toolBlock.input?.pattern as string || '';
                  console.log(chalk.gray(`   🔍 Grep: ${pattern}`));
                } else if (toolName === 'Bash') {
                  const cmd = (toolBlock.input?.command as string || '').slice(0, 60);
                  console.log(chalk.gray(`   💻 ${cmd}${cmd.length >= 60 ? '...' : ''}`));
                } else {
                  console.log(chalk.gray(`   🔧 ${toolName}`));
                }
              }
            }
          }
        }
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      // Parse JSON array from response
      // Try to extract JSON from code blocks first, then raw
      let jsonText: string | null = null;

      // Try markdown code block (```json ... ``` or ``` ... ```)
      const codeBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        const blockContent = codeBlockMatch[1].trim();
        if (blockContent.startsWith('[')) {
          jsonText = blockContent;
        }
      }

      // Fall back to finding raw JSON array - use last match to get final output
      if (!jsonText) {
        const allMatches = responseText.match(/\[[\s\S]*?\](?=\s*$|\s*```)/g);
        if (allMatches && allMatches.length > 0) {
          // Take the last match (final output)
          jsonText = allMatches[allMatches.length - 1];
        }
      }

      // Last resort: find any JSON array
      if (!jsonText) {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          jsonText = jsonMatch[0];
        }
      }

      if (!jsonText) {
        console.log(chalk.red(`\n✗ Plan analysis failed (${elapsed}s)`));
        // Include first 500 chars of response for debugging
        const preview = responseText.slice(0, 500);
        throw new Error(`No JSON array found in response. Response preview: ${preview}`);
      }

      // Try to parse, with better error reporting
      let parsed: Array<{
        id: number;
        title: string;
        body: string;
        dependencies: number[];
      }>;

      try {
        parsed = JSON.parse(jsonText);
      } catch (parseError) {
        console.log(chalk.red(`\n✗ JSON parse error (${elapsed}s)`));
        console.log(chalk.gray('JSON text (first 500 chars):'));
        console.log(chalk.gray(jsonText.slice(0, 500)));
        throw parseError;
      }

      console.log(chalk.green(`\n✓ Plan analyzed (${parsed.length} work items in ${elapsed}s)`));

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
      console.log(chalk.red('\n✗ Plan analysis failed'));
      throw new Error(`Failed to parse plan: ${error instanceof Error ? error.message : error}`);
    }
  }
}
