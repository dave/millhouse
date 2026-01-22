# Millhouse

Run millhouse to execute GitHub issues in parallel.

## Instructions

Run the millhouse CLI with the arguments provided in $ARGUMENTS.

**Important:** If the current Claude Code session is running with `--dangerously-skip-permissions`, add that flag to the millhouse command so spawned instances inherit the same permission level.

## Usage

```
/millhouse run --issue <N>                    # Execute issue and dependencies
/millhouse run --issue <N> --dry-run          # Plan without executing
/millhouse run --issues <N,N,N>               # Execute specific issues
/millhouse status                             # Show run status
/millhouse setup                              # Install slash commands
```

## Examples

```bash
# Run issue #5 and all its dependencies
millhouse run --issue 5

# Run with skipped permissions (for unattended execution)
millhouse run --issue 5 --dangerously-skip-permissions

# Dry run to see the execution plan
millhouse run --issue 5 --dry-run

# Check status of runs
millhouse status
```

Execute the command and wait for completion. Report the results including any PR URLs created.
