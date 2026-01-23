import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface ProjectScanResult {
  success: boolean;
  error?: string;
}

export type LogCallback = (message: string) => void;

export async function scanProject(
  projectPath: string,
  options: { dangerouslySkipPermissions?: boolean; onLog?: LogCallback } = {}
): Promise<ProjectScanResult> {
  const onLog = options.onLog ?? (() => {});

  return new Promise((resolve) => {
    const args = ['/init'];
    if (options.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    const claude = spawn('claude', args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    claude.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          onLog(trimmed);
        }
      }
    });

    claude.stderr.on('data', (_data: Buffer) => {
      // Ignore stderr
    });

    claude.on('close', async (code) => {
      if (code === 0) {
        // Verify CLAUDE.md was created
        const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
        try {
          await fs.access(claudeMdPath);
          resolve({ success: true });
        } catch {
          resolve({ success: false, error: 'CLAUDE.md was not created' });
        }
      } else {
        resolve({ success: false, error: `claude /init exited with code ${code}` });
      }
    });

    claude.on('error', (err) => {
      resolve({ success: false, error: `Failed to spawn claude: ${err.message}` });
    });
  });
}
