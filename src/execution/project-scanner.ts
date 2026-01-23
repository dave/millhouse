import { query } from '@anthropic-ai/claude-code';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SCAN_PROMPT = `Analyze this codebase and create a comprehensive summary for developers who need to implement features. Write your findings to a file called MILLHOUSE_PROJECT.md in the repository root.

The summary should include:

## Project Overview
- What this project does (1-2 paragraphs)
- Key technologies and frameworks used

## Directory Structure
- Purpose of each top-level directory
- Where different types of code live (components, utils, tests, etc.)

## Architecture
- High-level architecture and data flow
- Key modules and how they interact
- Important patterns used (e.g., MVC, event-driven, etc.)

## Key Files
- Entry points (main files, index files)
- Configuration files and what they control
- Important utility modules

## Conventions
- Naming conventions observed
- Code organization patterns
- Testing approach

## Build & Development
- How to build/run the project
- Key scripts in package.json (or equivalent)
- Environment setup requirements

Keep the summary concise but comprehensive - aim for 200-400 lines. Focus on information that helps someone implement new features correctly.`;

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

    const iterator = query({
      prompt: SCAN_PROMPT,
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
