# Plan to Issues

Convert a plan into GitHub issues formatted for Millhouse.

## Instructions

1. Read the plan from $ARGUMENTS (file path) or ask the user to describe it
2. Break it into discrete, implementable issues
3. For each issue, identify dependencies on other issues
4. Create issues in order using `gh issue create`, starting with issues that have no dependencies
5. Use the actual issue numbers returned by GitHub for dependency references

## Issue Format

Each issue should have:
- Clear, actionable title
- Description with specific file paths and implementation details
- `**Depends on #N**` line if it depends on another issue

## Example

```bash
gh issue create --title "Add math utilities" --body "Create \`src/utils/math.ts\` with add() and subtract() functions."
```

Then for dependent issues:
```bash
gh issue create --title "Create calculator" --body "Create \`src/calculator.ts\` that uses the math utilities.

**Depends on #1**"
```
