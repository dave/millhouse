# Millhouse

Millhouse orchestrates parallel Claude Code instances to automatically implement work items. It supports two modes:

- **GitHub Mode:** Point it at GitHub issues and it discovers related issues, analyzes dependencies, and creates a PR with all changes
- **Local Mode:** Define work items in a JSON file - no GitHub required

In both modes, Millhouse executes work items in parallel where possible, respecting dependency order.

## Quick Start

Use the `/millhouse` slash command within Claude Code to plan and create work items:

```
/millhouse issues           # Create GitHub issues from your plan
/millhouse local            # Create a local JSON file instead
```

Then run from terminal:

```bash
millhouse run                              # Run GitHub issues
millhouse run --file millhouse-work.json   # Run local work items
```

## How It Works (GitHub Mode)

### 1. Issue Discovery

When you run `millhouse run --issue 42`, it:
- Fetches issue #42 from GitHub
- Scans the issue body for references to other issues (`#1`, `#2`, etc.)
- Recursively fetches and scans those issues too
- Builds a complete list of all related issues

### 2. Dependency Analysis

Millhouse sends all discovered issues to Claude in a single API call to analyze dependencies. It understands:
- Explicit markers: "Depends on #1", "Blocked by #2", "After #3", "Requires #4"
- Logical dependencies: If issue B imports from a file that issue A creates
- Semantic relationships: If issue A "creates math utilities" and issue B "uses the math functions", Claude infers the dependency automatically

Example issue body:
```markdown
Create a Calculator class that uses the math utilities.

**Depends on #2** (math utilities must exist first)
```

### 3. Dependency Graph & Scheduling

Issues are organized into a directed acyclic graph (DAG) based on their dependencies. The scheduler:
- Starts all issues with no dependencies in parallel (up to concurrency limit)
- As each issue completes, unblocks dependent issues
- Dynamically schedules newly-unblocked issues

### 4. Parallel Execution with Git Worktrees

Each issue runs in complete isolation:
- Creates a branch: `millhouse/run-{runId}-issue-{N}`
- Creates a git worktree in `.millhouse/worktrees/issue-{N}`
- Claude Code runs in that worktree with full autonomy
- Changes are committed to the issue's branch

This means multiple Claude instances can work simultaneously without conflicts.

### 5. Merging & PR Creation

As each issue completes:
- Its branch is merged back into the main run branch
- The worktree is cleaned up
- Once all issues complete, a single PR is created with all changes

## How It Works (Local Mode)

Local mode works the same way as GitHub mode, but without GitHub:

1. **Define work items** in a JSON file (manually or via `/millhouse local`)
2. **Run millhouse** with `--file` flag
3. **Parallel execution** proceeds exactly as in GitHub mode
4. **Changes remain** on the local run branch (no PR created)

### Work Items File Format

```json
{
  "version": 1,
  "name": "Feature name",
  "items": [
    {
      "id": 1,
      "title": "Create math utilities",
      "body": "Create `src/utils/math.ts` with add and multiply functions..."
    },
    {
      "id": 2,
      "title": "Create calculator",
      "body": "Create calculator class...\n\n**Depends on #1**",
      "dependencies": [1]
    }
  ]
}
```

Each item needs:
- `id`: Unique numeric identifier
- `title`: Brief description
- `body`: Full implementation details (same format as GitHub issues)
- `dependencies`: (optional) Array of item IDs this depends on

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

### Recommended Workflow

**GitHub Mode:**
1. Plan with Claude Code, then use `/millhouse issues` to create GitHub issues
2. Run `millhouse run` from terminal

**Local Mode:**
1. Plan with Claude Code, then use `/millhouse local` to create a work items file
2. Run `millhouse run --file <path>` from terminal

### Setup Slash Command

Install the `/millhouse` slash command for Claude Code:

```bash
# Install to current project
millhouse setup

# Install globally (available in all projects)
millhouse setup --global
```

### Creating Work Items (Claude Code)

Use `/millhouse` within Claude Code to convert a plan into work items:

```
/millhouse issues              # Create GitHub issues interactively
/millhouse issues plan.md      # Create GitHub issues from a plan file

/millhouse local               # Create local JSON file interactively
/millhouse local plan.md       # Create local JSON file from a plan
```

### Running (Terminal)

Run `millhouse run` from your terminal:

**GitHub Mode:**
```bash
# Run all open issues in the repository
millhouse run

# Run issue #5 and all its dependencies
millhouse run --issue 5

# Specific issues only (no recursive discovery)
millhouse run --issues 1,2,3
```

**Local Mode:**
```bash
# Run from a local work items file
millhouse run --file millhouse-work.json
```

**Common Options:**
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

## Writing Work Items

For best results, write work items (issues or local items) that are:

**Specific and actionable:**
```markdown
Create `src/utils/math.ts` with functions:
- `add(a: number, b: number): number`
- `subtract(a: number, b: number): number`
```

**Explicit about dependencies:**
```markdown
**Depends on #2** - needs the math utilities to exist first
```

**Clear about file paths:**
```markdown
Create a file `src/calculator.ts` that imports from `src/utils/math.ts`
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
    "mergeStrategy": "squash",
    "branchPrefix": "millhouse/issue-"
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
│   └── issue-{N}/       # Git worktrees (temporary)
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
The CLI shows real-time activity for each issue with prefixed output:
```
[#1] 📝 Write: greeting.ts
[#2] 💻 npm test
[#3] 📖 Reading: package.json
```

## License

MIT
