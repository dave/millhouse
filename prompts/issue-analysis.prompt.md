Analyze these GitHub issues to determine their dependencies and optimal execution order.

## Issues to Analyze

{{issuesList}}

---

## Your Task

**DO NOT use TodoWrite, TaskCreate, or any task/todo tools. Only use Read, Glob, Grep, and Bash.**

1. First, use Read, Glob, and Grep to explore the codebase structure
2. Then analyze each issue semantically to determine dependencies

For each issue determine:
1. **dependencies**: Which issues MUST be completed BEFORE this issue can start
2. **affectedPaths**: File paths this issue will likely create or modify
3. **noWorkNeeded**: True if this is a meta/index issue that requires no actual code changes (e.g., tracking issues, index issues that just link to other issues, documentation-only issues)

Also provide a summary title and description for this entire set of issues.

## Dependency Analysis Guidelines

Analyze the **semantic meaning** of each issue, not just explicit keywords. Consider:

- **Explicit mentions**: "depends on #X", "after #X", "blocked by #X", "requires #X"
- **Logical ordering**: If issue A creates something that issue B uses, B depends on A
- **Feature flow**: Setup/infrastructure issues before features that use them
- **Data dependencies**: Schema/model changes before code that uses those models
- **API dependencies**: API endpoints before UI that calls them

Issues written by humans may not have explicit dependency markers - use your understanding of software development to infer the correct order.

---

## Required Output Format

After exploring the codebase, output ONLY a JSON object. No other text after the JSON.

```json
{
  "title": "Short summary title for all issues (e.g. 'Add user authentication')",
  "description": "A 1-2 sentence summary of what these issues accomplish together.",
  "issues": [
    {
      "issueNumber": 1,
      "dependencies": [],
      "affectedPaths": ["src/path/to/file.ts"],
      "noWorkNeeded": false
    },
    {
      "issueNumber": 2,
      "dependencies": [1],
      "affectedPaths": ["src/other/file.ts"],
      "noWorkNeeded": false
    },
    {
      "issueNumber": 3,
      "dependencies": [1, 2],
      "affectedPaths": [],
      "noWorkNeeded": true
    }
  ]
}
```

The JSON must be valid. Only include dependencies between issues in this list.
