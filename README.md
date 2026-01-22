# Millhouse

CLI tool that orchestrates multiple parallel Claude Code instances to automatically work on GitHub issues.

## Features

- **Automatic Issue Discovery**: Recursively discovers linked issues from a root issue
- **Dependency Analysis**: Uses Claude to analyze issues for dependencies
- **Parallel Execution**: Runs multiple Claude instances in parallel with dependency-aware scheduling
- **Git Worktrees**: Isolates each task in its own git worktree
- **Status Tracking**: GitHub labels show real-time status of each issue
- **Graceful Resume**: Interrupted runs can be resumed

## Installation

```bash
npm install
npm run build
npm link
```

## Prerequisites

- Node.js 20+
- GitHub CLI (`gh`) authenticated
- `ANTHROPIC_API_KEY` environment variable set

## Usage

### Start a Run

```bash
# From a root issue (recursively includes linked issues)
millhouse run --issue 42

# Specific issues (no recursion)
millhouse run --issues 42,43,44

# With custom concurrency
millhouse run --issue 42 -n 5

# Dry run (analyze only, no execution)
millhouse run --issue 42 --dry-run
```

### Check Status

```bash
# Show all runs
millhouse status

# Show specific run
millhouse status --run-id abc123

# Output as JSON
millhouse status --json
```

### Resume Interrupted Run

```bash
millhouse resume <run-id>
```

## How It Works

1. **Discovery**: Finds all issues linked from the root issue
2. **Analysis**: Uses Claude to analyze each issue for dependencies
3. **Graph Building**: Creates a dependency DAG
4. **Scheduling**: Dynamically schedules tasks as dependencies complete
5. **Execution**: Each task runs in an isolated git worktree with Claude
6. **Merging**: Completed tasks merge back to the run branch
7. **PR Creation**: Creates a single PR with all changes

## Configuration

Create `.millhouserc.json` in your project root:

```json
{
  "execution": {
    "concurrency": 3,
    "baseBranch": "main",
    "maxBudgetPerIssue": 5.0,
    "maxTotalBudget": 100.0,
    "continueOnError": true
  },
  "pullRequests": {
    "createAsDraft": true,
    "mergeStrategy": "squash",
    "branchPrefix": "millhouse/issue-"
  }
}
```

## GitHub Labels

Millhouse uses these labels to track status:

| Label | Meaning |
|-------|---------|
| `millhouse:queued` | Issue is in the execution queue |
| `millhouse:in-progress` | Claude is actively working on this |
| `millhouse:blocked` | Waiting for dependency to complete |
| `millhouse:failed` | Execution failed |
| `millhouse:done` | Work complete |

## State Storage

Run state is stored in `.millhouse/` directory:

```
.millhouse/
├── runs/
│   └── {run-id}.json    # Run state
└── worktrees.json       # Active worktree mapping
```

## License

MIT
