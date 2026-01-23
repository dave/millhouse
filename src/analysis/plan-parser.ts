import chalk from 'chalk';
import ora from 'ora';
import { query } from '@anthropic-ai/claude-code';
import type { AnalyzedIssue } from '../types.js';
import { loadTemplate } from '../utils/template-loader.js';

export class PlanParser {
  /**
   * Parse a plan into discrete work items with dependencies.
   */
  async parse(planContent: string): Promise<AnalyzedIssue[]> {
    const template = await loadTemplate('plan-analysis.prompt.md');
    const prompt = template.replace('{{plan}}', planContent);

    const startTime = Date.now();
    const spinner = ora('Analyzing plan...').start();

    // Update elapsed time every second
    const timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      spinner.text = `Analyzing plan... (${elapsed}s)`;
    }, 1000);

    try {
      const iterator = query({
        prompt,
        options: {
          cwd: process.cwd(),
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

      clearInterval(timerInterval);
      const elapsed = Math.floor((Date.now() - startTime) / 1000);

      // Parse JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        spinner.fail(`Plan analysis failed (${elapsed}s)`);
        throw new Error('No JSON array found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id: number;
        title: string;
        body: string;
        dependencies: number[];
      }>;

      spinner.succeed(`Plan analyzed (${parsed.length} work items in ${elapsed}s)`);

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
      clearInterval(timerInterval);
      spinner.fail('Plan analysis failed');
      throw new Error(`Failed to parse plan: ${error instanceof Error ? error.message : error}`);
    }
  }
}
