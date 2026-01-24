# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run in development mode with tsx
npm test               # Run tests with vitest
npm run typecheck      # Type check without building
```

## CLI Commands

```bash
millhouse init         # Parse plan from ~/.claude/plans/ → .millhouse/worklist.json
millhouse list         # Show worklist items with status
millhouse run          # Execute pending worklist items
millhouse save         # Create GitHub issues from worklist
millhouse load [nums]  # Load GitHub issues into worklist
millhouse status       # Show run status
millhouse resume <id>  # Resume interrupted run
millhouse clean        # Clean up leftover state
```

## Architecture Overview

Millhouse orchestrates parallel Claude Code instances to implement work items. It uses git worktrees for isolation and a dependency graph for scheduling.

### Core Flow

1. **Input** → Worklist (`.millhouse/worklist.json`)
2. **Schedule** → Queue items respecting dependencies, run in parallel
3. **Execute** → Each item runs in isolated git worktree with Claude Code
4. **Merge** → Run branch merges into current branch when complete

### Key Modules

- **`src/core/orchestrator.ts`** - Main coordinator, manages run lifecycle and graceful shutdown
- **`src/core/scheduler.ts`** - Task state machine (ready→running→completed/failed), concurrency control
- **`src/analysis/graph-builder.ts`** - DAG construction with graphlib
- **`src/execution/claude-runner.ts`** - Runs Claude in worktree, handles merge
- **`src/execution/worktree-manager.ts`** - Creates/cleans git worktrees in `.millhouse/worktrees/`
- **`src/storage/worklist-store.ts`** - Manages `.millhouse/worklist.json`
- **`src/storage/json-store.ts`** - Persists run state to `.millhouse/runs/{runId}.json`

### Prompt Templates

Located in `prompts/`:
- `implementation.prompt.md` - Main worker instructions for implementing a task
- `issue-analysis.prompt.md` - Analyzes GitHub issues for dependencies
- `plan-analysis.prompt.md` - Breaks plans into work items

### Runtime Artifacts

- `.millhouse/worklist.json` - Worklist with items and status
- `.millhouse/runs/{runId}.json` - Persisted run state
- `.millhouse/worktrees/` - Git worktrees for parallel workers
- Branches: `millhouse/run-{runId}-issue-{N}`

## TypeScript Configuration

- Strict mode enabled
- Target: ES2022
- Module: NodeNext (ESM)
- Output: `dist/`

## Key Dependencies

- `@anthropic-ai/claude-code` - Claude Code programmatic interface
- `graphlib` - Dependency graph operations
- `@octokit/rest` - GitHub API
- `zod` - Configuration schema validation
