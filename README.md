# Millhouse

<div>
  <img src="millhouse.jpg" alt="Millhouse">
  <p align="right"><sub><a href="https://www.reddit.com/r/simpsonsshitposting/s/ZB5cDcwnqU">Unedited artwork</a> by <a href="https://www.shlives.net/">shlives</a></sub></p>
</div>

Millhouse orchestrates parallel Claude Code instances to automatically implement work items. It supports two workflows:

- **Plan Mode:** Give it a plan file (markdown) and it breaks it into work items, analyzes dependencies, and executes them in parallel.
- **GitHub Mode:** Load GitHub issues into a worklist, analyze dependencies, and execute.

In both modes, Millhouse executes work items in parallel where possible, respecting dependency order.

## Quick Start

### From a Plan

```bash
millhouse init          # Parse ~/.claude/plans/*.md → .millhouse/worklist.json
millhouse list          # See work items
millhouse run           # Execute!
```

### From GitHub Issues

```bash
millhouse load          # Load all open issues → .millhouse/worklist.json
millhouse load 5,6,7    # Load specific issues
millhouse list          # See work items
millhouse run           # Execute!
```

## Installation

```bash
npm install -g millhouse
```

## Commands

### millhouse init

Parse a plan file and create a worklist.

```bash
millhouse init              # Parse latest plan in ~/.claude/plans/
millhouse init --force      # Overwrite existing worklist
```

If a worklist already exists, you'll be prompted to overwrite or append.

### millhouse list

Show items in the current worklist.

```bash
millhouse list
```

Displays items grouped by status (ready, blocked, completed, failed) with dependency information.

### millhouse run

Execute pending worklist items with parallel workers.

```bash
millhouse run                           # Run all pending items
millhouse run -n 16                     # Use 16 parallel workers
millhouse run --dry-run                 # Preview without executing
millhouse run --dangerously-skip-permissions  # Unattended execution
```

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
millhouse load 5,6,7        # Load issues 5, 6, 7 and linked issues
```

Uses Claude to analyze dependencies and expand sparse issues with testing instructions and acceptance criteria.

### Other Commands

```bash
millhouse status             # Show all runs
millhouse status --run-id X  # Show specific run
millhouse resume <run-id>    # Resume interrupted run
millhouse clean              # Clean up leftover state
```

## How It Works

### Dependency Analysis

Dependencies can be specified explicitly or inferred:
- Explicit markers: "Depends on #1", "Blocked by #2", "After #3"
- For GitHub issues: Claude analyzes semantic relationships

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

## Writing Good Plans

For best results, write plans that include:

**Clear task separation:**
```markdown
## 1. Create Math Utilities
Create `src/math.ts` with add, subtract, multiply, divide functions.

## 2. Create Calculator Class
Create `src/calculator.ts` that uses the math utilities.
**Depends on task 1.**
```

**Specific implementation details:**
```markdown
Create `src/math.ts` with:
- `add(a: number, b: number): number`
- `subtract(a: number, b: number): number`
```

**Testing instructions:**
```markdown
## Testing
Run `npm test` - all tests should pass.
Run `npm run build` - should compile without errors.
```

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

## Configuration

Create `.millhouserc.json` in your project root:

```json
{
  "execution": {
    "concurrency": 8,
    "baseBranch": "main",
    "continueOnError": true
  }
}
```

| Option | Description | Default |
|---|---|---|
| `concurrency` | Max parallel Claude instances | 8 |
| `baseBranch` | Branch to base work on | main |
| `continueOnError` | Keep going if one item fails | true |

## Troubleshooting

**Worktree errors after interrupted run?**
```bash
millhouse clean
```

**To see what Claude is doing:**
Use `-d detailed` to start in detailed view, or press `v` to toggle during execution.

## License

MIT
