Analyze this plan and break it into discrete, implementable work items.

## Plan

{{plan}}

---

## Your Task

Break this plan into discrete work items that can be implemented independently (but may have dependencies on each other).

For each work item, provide:
1. **id**: Sequential number starting from 1
2. **title**: Short descriptive title
3. **body**: Full implementation details including:
   - What to create/modify
   - Specific file paths
   - Function signatures or interfaces
   - Testing instructions
   - Acceptance criteria
4. **dependencies**: IDs of work items that MUST be completed before this one

Respond with ONLY a JSON array (no markdown, no explanation):
[
  {
    "id": 1,
    "title": "Initialize project",
    "body": "Create the project structure...\n\n## Implementation\n...",
    "dependencies": []
  },
  {
    "id": 2,
    "title": "Create utilities",
    "body": "Create utility functions...\n\n**Depends on #1**\n\n## Implementation\n...",
    "dependencies": [1]
  }
]

Rules:
- Each work item should be self-contained with all context needed to implement it
- Include "**Depends on #N**" in the body text for any dependencies
- Work items should be small enough to implement in one session
- Include specific file paths, function signatures, and acceptance criteria
- Respond with ONLY valid JSON, nothing else
