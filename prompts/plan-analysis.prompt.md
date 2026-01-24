Break this plan into discrete work items for parallel execution.

## Plan

{{plan}}

---

## Your Task

1. Use Read, Glob, and Grep tools to explore the codebase
2. Output a JSON array of work items

**DO NOT use TodoWrite, TaskCreate, or any task/todo tools. Only use Read, Glob, Grep, and Bash.**

## Context

Work items will be executed by parallel Claude instances in isolated contexts. Each item must be completely self-contained with all information needed.

## Work Item Guidelines

- Each item should be completable in one session
- Include exact file paths, function signatures, patterns to follow
- Use `"dependencies": [1, 2]` for prerequisite items
- Only add dependencies that are truly required

---

## Required Output Format

After exploring the codebase, output ONLY a JSON array. No other text after the JSON.

Use \n for newlines in body text. Keep body content concise.

```json
[
  {
    "id": 1,
    "title": "Short title",
    "body": "Implementation details. File: src/foo.ts. Pattern: follow existing style.",
    "dependencies": []
  },
  {
    "id": 2,
    "title": "Another task",
    "body": "More details here.",
    "dependencies": [1]
  }
]
```

The JSON must be valid. Use \n for newlines, escape quotes with backslash.
