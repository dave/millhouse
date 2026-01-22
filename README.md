# Millhouse

Millhouse orchestrates parallel Claude Code instances to automatically implement work items. It supports two modes:

- **GitHub Mode:** Point it at GitHub issues and it discovers related issues, analyzes dependencies, and creates a PR with all changes
- **Plan Mode:** Give it any plan file (markdown, text) and it breaks it into work items automatically - no GitHub required

In both modes, Millhouse executes work items in parallel where possible, respecting dependency order.

## Quick Start

**GitHub Mode** - use the slash command to create issues, then run:
```
/millhouse issues           # Create GitHub issues from your plan
```
```bash
millhouse run --issue 5     # Run issue #5 and dependencies
```

**Plan Mode** - just write a plan and run it directly:
```bash
millhouse run --plan plan.md
```

## How It Works (GitHub Mode)

### 1. Issue Discovery

When you run `millhouse run --issue 42`, it:
- Fetches issue #42 from GitHub
- Scans the issue body for references to other issues (`#1`, `#2`, etc.)
- Recursively fetches and scans those issues too
- Builds a complete list of all related issues

### 2. Dependency Analysis

Millhouse sends all discovered issues to Claude to analyze dependencies. It understands:
- Explicit markers: "Depends on #1", "Blocked by #2", "After #3", "Requires #4"
- Logical dependencies: If issue B imports from a file that issue A creates
- Semantic relationships: Claude infers dependencies automatically

### 3. Dependency Graph & Scheduling

Issues are organized into a directed acyclic graph (DAG). The scheduler:
- Starts all issues with no dependencies in parallel (up to concurrency limit)
- As each issue completes, unblocks dependent issues
- Dynamically schedules newly-unblocked issues

### 4. Parallel Execution with Git Worktrees

Each issue runs in complete isolation:
- Creates a branch: `millhouse/run-{runId}-issue-{N}`
- Creates a git worktree in `.millhouse/worktrees/run-{runId}-issue-{N}`
- Claude Code runs in that worktree with full autonomy
- Changes are committed to the issue's branch

### 5. Merging & PR Creation

As each issue completes:
- Its branch is merged back into the main run branch
- The worktree is cleaned up
- Once all issues complete, a single PR is created with all changes

## How It Works (Plan Mode)

Plan mode works the same way, but Claude parses your plan file directly:

1. **Write a plan** - any markdown or text describing what you want to build
2. **Run millhouse** with `--plan` flag
3. **Claude analyzes** the plan, breaking it into discrete work items with dependencies
4. **Parallel execution** proceeds exactly as in GitHub mode
5. **Changes remain** on the local run branch (no PR created)

Example plan file:
```markdown
# Calculator Project

Build a simple calculator library in TypeScript.

## Components

1. Math utilities - basic add, subtract, multiply, divide functions
2. Calculator class - uses math utilities, maintains state
3. CLI interface - command-line calculator using the Calculator class
4. Tests - unit tests for all components
```

Millhouse will parse this into work items, determine that the CLI depends on Calculator which depends on Math utilities, and execute in the correct order.

## Installation

```bash
npm install
npm run build
npm link
```

## Prerequisites

- Node.js 20+
- Claude Code installed and authenticated
- GitHub CLI (`gh`) authenticated (GitHub mode only)

## Usage

### Setup Slash Command

Install the `/millhouse` slash command for Claude Code:

```bash
millhouse setup           # Install to current project
millhouse setup --global  # Install globally
```

### GitHub Mode

```bash
# Run all open issues in the repository
millhouse run

# Run issue #5 and all its dependencies
millhouse run --issue 5

# Specific issues only (no recursive discovery)
millhouse run --issues 1,2,3
```

### Plan Mode

```bash
# Run from a plan file
millhouse run --plan plan.md
millhouse run --plan TODO.txt
millhouse run --plan features.md
```

### Common Options

```bash
# With skipped permissions for unattended execution
millhouse run --dangerously-skip-permissions

# Dry run to preview the execution plan
millhouse run --dry-run

# Adjust parallelism (default: 8)
millhouse run -n 5
```

### Check Status

```bash
millhouse status              # Show all runs
millhouse status --run-id X   # Show specific run
millhouse status --json       # Output as JSON
```

### Resume Interrupted Run

If you interrupt a run (Ctrl+C), it saves state automatically:

```bash
millhouse resume <run-id>
```

## Writing Good Plans

For best results, write plans that are:

**Clear about what to build:**
```markdown
Create a math utilities module with:
- add(a, b) - returns sum
- multiply(a, b) - returns product
```

**Explicit about dependencies:**
```markdown
The Calculator class should use the math utilities module.
```

**Specific about file structure:**
```markdown
Put math utilities in src/utils/math.ts
Put the Calculator class in src/calculator.ts
```

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
|--------|-------------|---------|
| `concurrency` | Max parallel Claude instances | 8 |
| `baseBranch` | Branch to base work on | main |
| `continueOnError` | Keep going if one issue fails | true |
| `createAsDraft` | Create PR as draft | true |
| `mergeStrategy` | PR merge strategy | squash |

## GitHub Labels (GitHub Mode Only)

In GitHub mode, Millhouse automatically manages labels to show progress:

| Label | Meaning |
|-------|---------|
| `millhouse:queued` | Waiting in queue |
| `millhouse:in-progress` | Claude is actively working |
| `millhouse:blocked` | Waiting for dependency |
| `millhouse:failed` | Execution failed |
| `millhouse:done` | Completed successfully |

## State Storage

```
.millhouse/
├── runs/
│   └── {run-id}.json    # Full run state (resumable)
├── worktrees/
│   └── run-{runId}-issue-{N}/  # Git worktrees (temporary)
└── worktrees.json       # Active worktree tracking
```

## Troubleshooting

**Worktree errors after interrupted run:**
```bash
millhouse clean
```

Or manually:
```bash
rm -rf .millhouse
git worktree prune
git branch | grep millhouse | xargs git branch -D
```

**To see what Claude is doing:**
The CLI shows real-time activity for each work item:
```
[#1] 📝 Write: math.ts
[#2] 💻 npm test
[#3] 📖 Reading: package.json
```

## License

MIT
