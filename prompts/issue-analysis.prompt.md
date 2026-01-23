Analyze these GitHub issues and determine their dependencies and execution order.

## Issues to Analyze

{{issuesList}}

---

## Your Task

Analyze each issue and determine:
1. **dependencies**: Which issues MUST be completed BEFORE this issue can start
2. **affectedPaths**: File paths this issue will likely create or modify

Respond with ONLY a JSON array (no markdown, no explanation):
[
  {
    "issueNumber": 1,
    "dependencies": [],
    "affectedPaths": ["src/path/to/file.ts"]
  },
  {
    "issueNumber": 2,
    "dependencies": [1],
    "affectedPaths": ["src/other/file.ts"]
  }
]

Rules:
- Look for explicit dependency mentions: "depends on #X", "after #X", "blocked by #X", "requires #X"
- Also infer logical dependencies (e.g., if issue B imports from a file that issue A creates)
- Only include dependencies between issues in this list
- affectedPaths should be specific file paths mentioned or implied
- Respond with ONLY valid JSON, nothing else
