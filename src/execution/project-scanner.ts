import { query } from '@anthropic-ai/claude-code';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadTemplate } from '../utils/template-loader.js';

export interface ProjectScanResult {
  success: boolean;
  summary?: string;
  error?: string;
}

export async function scanProject(
  projectPath: string,
  options: { dangerouslySkipPermissions?: boolean } = {}
): Promise<ProjectScanResult> {
  try {
    const permissionMode = options.dangerouslySkipPermissions ? 'bypassPermissions' : 'acceptEdits';
    const prompt = await loadTemplate('project-scan.prompt.md');

    const iterator = query({
      prompt,
      options: {
        cwd: projectPath,
        model: 'claude-sonnet-4-20250514',
        permissionMode,
        maxTurns: 20,
      },
    });

    // Consume the iterator
    for await (const _message of iterator) {
      // Just wait for completion
    }

    // Check if summary was created
    const summaryPath = path.join(projectPath, 'MILLHOUSE_PROJECT.md');
    try {
      const summary = await fs.readFile(summaryPath, 'utf-8');
      // Clean up the file from main repo (it will be copied to worktrees)
      await fs.unlink(summaryPath);
      return { success: true, summary };
    } catch {
      return { success: false, error: 'Summary file was not created' };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
