# Millhouse

<div>
  <img src="millhouse.jpg" alt="Millhouse">
  <p align="right"><sub><a href="https://www.reddit.com/r/simpsonsshitposting/s/ZB5cDcwnqU">Unedited artwork</a> by <a href="https://www.shlives.net/">shlives</a></sub></p>
</div>

Millhouse orchestrates Claude instances to implement large plans with hundreds of 
separate work items. 

It analyzes your plan, automatically works out the dependencies, and runs as much 
as possible in parallel. Each item runs in an isolated git worktree, and in a fresh 
Claude context.

This is intended for unattended operation - leave Millhouse running overnight!

## Quick Start

**1. Create a worklist**:

```bash
millhouse init
```

Analyzes the latest Claude plan and creates a worklist (`.millhouse/worklist.json`)

**2. Run it:**

```bash
millhouse run [--dangerously-skip-permissions]
```

That's it. Millhouse builds a dependency graph, runs items in parallel where possible, 
and merges everything back when done.

## Installation

```bash
npm install -g millhouse
```

## Commands

### millhouse init

Create a worklist from a Claude Code plan - Millhouse finds the most recent plan 
for the current project.

```bash
millhouse init
```

### millhouse list

Show items in the current worklist.

```bash
millhouse list [--verbose]
```

Displays items grouped by status (ready, blocked, completed, failed) with dependency information.

### millhouse run

Execute pending worklist items with parallel workers.

```bash
millhouse run                     # Run all pending items
  -n 16                           # Use 16 parallel workers (default: 8)
  --dry-run                       # Preview without executing
  --dangerously-skip-permissions  # Pass to claude tool for reliable unattended execution
```

Note: Use `--dangerously-skip-permissions` with care!

### millhouse save

Create GitHub issues from the worklist.

```bash
millhouse save
```

Creates issues in dependency order, updates the worklist with issue numbers, and creates an index issue linking all items.

### millhouse load

Load GitHub issues into the worklist.

```bash
millhouse load              # Load all open issues
millhouse load 5            # Load issue #5 and linked issues
millhouse load 5,6,7        # Load issues 5, 6, 7 and all linked issues
```

Uses Claude to analyze dependencies and expand sparse issues with testing instructions and acceptance criteria.

### Other Commands

```bash
millhouse status             # Show all runs
millhouse clean              # Clean up leftover state
```

## How It Works

### Dependency Analysis

Claude analyzes semantic relationships between plan items to determine dependencies.

### Parallel Execution

Work items are organized into a dependency graph. The scheduler:
- Starts all items with no dependencies in parallel (up to concurrency limit)
- As each item completes, unblocks dependent items
- Dynamically schedules newly-unblocked items

### Git Worktrees

Each work item runs in complete isolation:
- Creates a branch: `millhouse/run-{runId}-issue-{N}`
- Creates a git worktree in `.millhouse/worktrees/`
- Claude Code runs in that worktree with full autonomy
- On completion, branches are merged back to the run branch
- Run branch is merged into your current branch when done

### Working Directory Requirements

Before starting a run, Millhouse checks that your working directory is clean to prevent merge conflicts:

- **Gitignored files are allowed** - `.millhouse/` is automatically added to `.gitignore` on first use
- **CLAUDE.md auto-commit** - If `CLAUDE.md` is the only untracked file, it's automatically committed
- **Other changes must be committed** - Any other uncommitted changes or untracked files will block the run

This ensures the final merge back to your branch won't fail due to conflicts with local changes.

## Creating Plans

Plans are created interactively using Claude Code's plan mode:

```bash
claude
> /plan Add user authentication with JWT
```

Claude will create a structured plan with numbered tasks and dependencies. The plan is saved to `~/.claude/plans/` and can then be loaded with `millhouse init`.

For best results, when discussing your plan with Claude:
- Be specific about implementation details
- Mention testing requirements
- Clarify dependencies between tasks

## Development Install

```bash
git clone https://github.com/dave/millhouse.git
cd millhouse
npm install
npm run build
npm link
```

## Prerequisites

- Node.js 20+
- Claude Code installed and authenticated
- GitHub CLI (`gh`) authenticated (for GitHub commands)

## Troubleshooting

**"Working directory is not clean" error?**

Millhouse requires a clean git state before runs. Options:
- Commit your changes: `git add -A && git commit -m "WIP"`
- Stash your changes: `git stash`
- If only `CLAUDE.md` is untracked, it will be auto-committed

**Worktree errors after interrupted run?**
```bash
millhouse clean
```

**To see what Claude is doing:**
Use `-d detailed` to start in detailed view, or press `v` to toggle during execution.

## License

MIT
