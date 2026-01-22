# Millhouse

Millhouse orchestrates parallel Claude Code instances to automatically implement GitHub issues. Point it at an issue and it will discover related issues, analyze dependencies, and execute them in parallel where possible - respecting dependency order. When complete, it creates a single PR with all changes.

## How It Works

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

## Installation

```bash
npm install
npm run build
npm link
```

## Prerequisites

- Node.js 20+
- GitHub CLI (`gh`) authenticated
- Claude Code installed and authenticated

## Usage

### Recommended Workflow

1. **Plan with Claude Code:** Describe what you want to build, then use `/millhouse issues` to create GitHub issues
2. **Run from terminal:** Execute `millhouse run` directly in your terminal for long-running jobs

This split is recommended because Claude Code's Bash tool has a 10-minute timeout, which isn't enough for multi-issue runs that may take hours.

### Setup Slash Command

Install the `/millhouse` slash command for Claude Code:

```bash
# Install to current project
millhouse setup

# Install globally (available in all projects)
millhouse setup --global
```

### Creating Issues (Claude Code)

Use `/millhouse issues` within Claude Code to convert a plan into properly formatted GitHub issues:

```
/millhouse issues              # Describe your plan interactively
/millhouse issues plan.md      # Create issues from a plan file
```

This is interactive and works well within Claude Code's timeout limits.

### Running Issues (Terminal)

Run millhouse directly from your terminal for execution - especially for overnight or long-running jobs:

```bash
# Run all open issues in the repository
millhouse run

# Run issue #5 and all its dependencies
millhouse run --issue 5

# With skipped permissions for unattended execution
millhouse run --dangerously-skip-permissions

# Dry run to preview the execution plan
millhouse run --dry-run
```

### More CLI Options

```bash
# Specific issues only (no recursive discovery)
millhouse run --issues 1,2,3

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

## Writing Issues for Millhouse

For best results, write issues that are:

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

## GitHub Labels

Millhouse automatically manages labels to show progress:

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
