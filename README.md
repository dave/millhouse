# Millhouse

<div>
  <img src="millhouse.jpg" alt="Millhouse">
  <p align="right"><sub><a href="https://www.reddit.com/r/simpsonsshitposting/s/ZB5cDcwnqU">Unedited artwork</a> by <a href="https://www.shlives.net/">shlives</a></sub></p>
</div>

Millhouse orchestrates parallel Claude Code instances to automatically implement work items. It supports two modes:

- **GitHub Mode:** Point it at GitHub issues and it discovers related issues, analyzes dependencies, executes and creates a PR with all changes.
- **Plan Mode:** Give it any plan file (markdown, text) and it breaks it into work items automatically, analyzes dependencies and executes.

In both modes, Millhouse executes work items in parallel where possible, respecting dependency order.

## Quick Start

### Plan Mode

In Claude Code:
```
/millhouse plan             # Analyze plan.md and save as millhouse-plan.json
```
... then exit Claude Code and run at the command line:
```bash
millhouse run               # Execute from millhouse-plan.json (fast!)
```

### GitHub Issues Mode

In Claude Code:
```
/millhouse plan             # Analyze plan.md and save as millhouse-plan.json
/millhouse issues           # Create GitHub issues from JSON plan
```
... then exit Claude Code and run at the command line:
```bash
millhouse run issues        # Run all open GitHub issues
millhouse run issues 5      # Run issue #5 and linked issues
```

## Installation

```bash
npm install -g millhouse
```

Then install the `/millhouse` slash command for Claude Code:

```bash
millhouse setup --global
```

## Slash Commands

### /millhouse plan

Analyzes a plan file and saves as JSON for fast execution. Run this before `millhouse run` or `/millhouse issues`.

```
/millhouse plan                # Analyze plan.md → millhouse-plan.json
/millhouse plan myfeature      # Analyze plan.md → millhouse-plan-myfeature.json
```

This creates a JSON file with:
- **Work items** - each with title, body, and dependencies
- **Dependency graph** - which items must complete before others
- **Full context** - all implementation details preserved

### /millhouse issues

Creates GitHub issues from a JSON plan. Run `/millhouse plan` first.

```
/millhouse issues              # Create issues from millhouse-plan.json
/millhouse issues myfeature    # Create issues from millhouse-plan-myfeature.json
```

## How It Works

### Project Scanning

Before workers start, Millhouse scans your project with Claude to generate a comprehensive summary including:
- Project structure and architecture
- Key files and what they do
- Coding conventions and patterns
- Build system and dependencies

This summary is passed to each worker, giving them essential context even if your project lacks documentation. Use `--no-scan` to skip this step for projects with comprehensive docs.

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
| Input | GitHub issues                              | JSON plan file                |
| Setup | `/millhouse plan` then `/millhouse issues` | `/millhouse plan`             |
| Run | `millhouse run issues [id]`                | `millhouse run [name]`        |
| Output | Pull request                               | Changes on local branch       |
| Labels | Auto-managed                               | N/A                           |

## CLI Reference

### Running

```bash
# Plan mode (default) - uses JSON plan for fast execution
millhouse run                    # Run from millhouse-plan.json
millhouse run myfeature          # Run from millhouse-plan-myfeature.json

# GitHub issues mode (always discovers linked issues)
millhouse run issues             # Run all open issues
millhouse run issues 5           # Run issue #5 and linked issues
millhouse run issues 1,2,3       # Run these issues and linked issues

# Options (work with both modes)
--dry-run                        # Preview without executing
--no-scan                        # Skip project scanning (see below)
-n 16                            # Set parallel workers (default: 8)
-d detailed                      # Start in detailed view (default: compact)
--dangerously-skip-permissions   # Unattended execution
```

**Note:** If no JSON plan is found, `millhouse run` falls back to analyzing markdown plans from `~/.claude/plans/`.

### Other Commands

```bash
millhouse status                 # Show all runs
millhouse status --run-id X      # Show specific run
millhouse resume <run-id>        # Resume interrupted run
millhouse clean                  # Clean up leftover state
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

### Development Install

If you want to contribute or modify millhouse:

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

**Worktree errors after interrupted run?**
```bash
millhouse clean
```

**To see what Claude is doing:**
The CLI shows real-time activity for each work item. Use `-d detailed` to start in detailed view, or press `v` to toggle during execution.

## License

MIT
