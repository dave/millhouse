import { query } from '@anthropic-ai/claude-code';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadTemplate } from '../utils/template-loader.js';

export interface ProjectScanResult {
  success: boolean;
  summary?: string;
  error?: string;
}

export type LogCallback = (message: string) => void;

export async function scanProject(
  projectPath: string,
  options: { dangerouslySkipPermissions?: boolean; onLog?: LogCallback } = {}
): Promise<ProjectScanResult> {
  try {
    const permissionMode = options.dangerouslySkipPermissions ? 'bypassPermissions' : 'acceptEdits';
    const prompt = await loadTemplate('project-scan.prompt.md');
    const onLog = options.onLog ?? (() => {});

    const iterator = query({
      prompt,
      options: {
        cwd: projectPath,
        model: 'claude-sonnet-4-20250514',
        permissionMode,
        maxTurns: 20,
      },
    });

    // Consume the iterator while logging output
    for await (const message of iterator) {
      const msg = message as unknown as Record<string, unknown>;

      if (msg.type === 'assistant') {
        const assistantMsg = msg.message as Record<string, unknown> | undefined;
        if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
          for (const block of assistantMsg.content) {
            if (typeof block === 'object' && block && 'type' in block && block.type === 'text' && 'text' in block) {
              const text = String(block.text);
              const preview = text.slice(0, 80).replace(/\n/g, ' ');
              onLog(`${preview}${text.length > 80 ? '...' : ''}`);
            } else if (typeof block === 'object' && block && 'type' in block && block.type === 'tool_use') {
              const toolBlock = block as { name?: string; input?: Record<string, unknown> };
              const toolName = toolBlock.name || 'unknown';
              if (toolName === 'Read') {
                const filePath = toolBlock.input?.file_path as string || '';
                const fileName = filePath.split('/').pop() || filePath;
                onLog(`📖 Reading: ${fileName}`);
              } else if (toolName === 'Glob' || toolName === 'Grep') {
                const pattern = toolBlock.input?.pattern as string || '';
                onLog(`🔍 ${toolName}: ${pattern}`);
              } else if (toolName === 'Write') {
                const filePath = toolBlock.input?.file_path as string || '';
                const fileName = filePath.split('/').pop() || filePath;
                onLog(`📝 Writing: ${fileName}`);
              } else if (toolName === 'Bash') {
                const cmd = (toolBlock.input?.command as string || '').slice(0, 50);
                onLog(`💻 ${cmd}${cmd.length >= 50 ? '...' : ''}`);
              } else {
                onLog(`🔧 ${toolName}`);
              }
            }
          }
        }
      }
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
