# Millhouse

Millhouse orchestrates parallel Claude Code instances to automatically implement work items. It supports two modes:

- **GitHub Mode:** Point it at GitHub issues and it discovers related issues, analyzes dependencies, and creates a PR with all changes
- **Plan Mode:** Give it any plan file (markdown, text) and it breaks it into work items automatically - no GitHub required

In both modes, Millhouse executes work items in parallel where possible, respecting dependency order.

## Quick Start

### Plan Mode

In Claude Code:
```
/millhouse plan             # Refine your plan for millhouse
```
... then exit Claude Code and run at the command line:
```bash
millhouse run               # Execute the most recent plan
millhouse run plan.md       # Execute a specific plan file
```

### GitHub Issues Mode

In Claude Code:
```
/millhouse plan             # Refine your plan for millhouse
/millhouse issues           # Create GitHub issues from your plan
```
... then exit Claude Code and run at the command line:
```bash
millhouse run issues        # Run all open GitHub issues
millhouse run issues 5      # Run issue #5 and linked issues
millhouse run issues 1,2,3  # Run these issues and any linked issues
```

## Slash Commands

### /millhouse plan

Refines a rough plan into a millhouse-ready format. Use this before running `/millhouse issues` or `millhouse run`.

```
/millhouse plan                # Refine the current plan
/millhouse plan plan.md        # Refine an existing plan file
```

This transforms your plan to have:
- **Clearly separated work items** - each runs in a separate context
- **Appropriately-sized tasks** - small enough to complete unattended
- **Self-contained descriptions** - all context included, nothing assumed
- **Acceptance criteria** - how to verify each task is complete
- **Testing instructions** - specific commands and expected results
- **Explicit dependencies** - what must complete before each task

### /millhouse issues

Creates GitHub issues from a plan. Use this for GitHub mode.

```
/millhouse issues              # Create issues from the current plan
/millhouse issues plan.md      # Create issues from a plan file
```

## How It Works

### Dependency Analysis

When you run millhouse, it sends your work items to Claude to analyze dependencies. It understands:
- Explicit markers: "Depends on #1", "Blocked by #2", "After #3"
- Logical dependencies: If task B imports from a file that task A creates
- Semantic relationships: Claude infers dependencies automatically

### Parallel Execution

Work items are organized into a dependency graph. The scheduler:
- Starts all items with no dependencies in parallel (up to concurrency limit)
- As each item completes, unblocks dependent items
- Dynamically schedules newly-unblocked items

### Git Worktrees

Each work item runs in complete isolation:
- Creates a branch: `millhouse/run-{runId}-issue-{N}`
- Creates a git worktree in `.millhouse/worktrees/run-{runId}-issue-{N}`
- Claude Code runs in that worktree with full autonomy
- Changes are committed to the item's branch
- On completion, branches are merged back to the run branch

### GitHub Mode vs Plan Mode

| | GitHub Mode                                | Plan Mode                     |
|---|--------------------------------------------|---------------------------------|
| Input | GitHub issues                              | Any text/markdown file        |
| Setup | `/millhouse plan` then `/millhouse issues` | `/millhouse plan`             |
| Run | `millhouse run issues [N]`                 | `millhouse run [file.md]`     |
| Output | Pull request                               | Changes on local branch       |
| Labels | Auto-managed                               | N/A                           |

## CLI Reference

### Running

```bash
# Plan mode (default)
millhouse run                    # Run most recent plan from ~/.claude/plans/
millhouse run plan.md            # Run a specific plan file

# GitHub issues mode (always discovers linked issues)
millhouse run issues             # Run all open issues
millhouse run issues 5           # Run issue #5 and linked issues
millhouse run issues 1,2,3       # Run these issues and linked issues

# Options (work with both modes)
millhouse run --dry-run          # Preview without executing
millhouse run -n 16              # Set parallel workers (default: 8)
millhouse run -d detailed        # Start in detailed view (default: compact)
millhouse run --dangerously-skip-permissions  # Unattended execution
```

### Other Commands

```bash
millhouse status              # Show all runs
millhouse status --run-id X   # Show specific run
millhouse resume <run-id>     # Resume interrupted run
millhouse clean               # Clean up leftover state
```

## Writing Good Plans

For best results, use `/millhouse plan` to refine your plan. Or write plans that include:

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

**Acceptance criteria:**
```markdown
## Acceptance Criteria
- [ ] All four math functions exported
- [ ] Tests cover edge cases (division by zero)
- [ ] TypeScript compiles with strict mode
```

## Installation

```bash
npm install
npm run build
npm link
```

Install the `/millhouse` slash command for Claude Code:

```bash
millhouse setup           # Install to current project
millhouse setup --global  # Install globally
```


## Prerequisites

- Node.js 20+
- Claude Code installed and authenticated
- GitHub CLI (`gh`) authenticated (GitHub mode only)

## Configuration

Create `.millhouserc.json` in your project root:

```json
{
  "execution": {
    "concurrency": 8,
    "baseBranch": "main",
    "continueOnError": true
  },
  "pullRequests": {
    "createAsDraft": true,
    "mergeStrategy": "squash"
  }
}
```

| Option | Description | Default |
|---|---|---|
| `concurrency` | Max parallel Claude instances | 8 |
| `baseBranch` | Branch to base work on | main |
| `continueOnError` | Keep going if one item fails | true |
| `createAsDraft` | Create PR as draft | true |
| `mergeStrategy` | PR merge strategy | squash |

## GitHub Labels (GitHub Mode Only)

Millhouse automatically manages labels to show progress:

| Label | Meaning |
|---|---|
| `millhouse:queued` | Waiting in queue |
| `millhouse:in-progress` | Claude is actively working |
| `millhouse:blocked` | Waiting for dependency |
| `millhouse:failed` | Execution failed |
| `millhouse:done` | Completed successfully |

## Troubleshooting

**Worktree errors after interrupted run:**
```bash
millhouse clean
```

**To see what Claude is doing:**
The CLI shows real-time activity for each work item. Use `-d detailed` to start in detailed view, or press `v` to toggle during execution.

## License

MIT
