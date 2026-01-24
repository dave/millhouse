IMPORTANT: Your response must be ONLY a valid JSON array. No explanations, no markdown, no other text.

Break this plan into discrete work items for parallel execution:

{{plan}}

---

## Context

These work items will be executed by **parallel Claude Code instances**, each running **unattended in its own isolated context**. This means:
- Each item runs in a fresh context with no memory of other items
- Items must be completely self-contained with ALL context needed
- Nothing can be assumed or left implicit
- Multiple items with no dependencies run simultaneously

## Guidelines

**1. Size appropriately**
- Each item should be completable in one unattended session
- "Create an entire application" is too big - break it down
- "Add a single line" might be too small unless it's a dependency

**2. Make self-contained**
- Include ALL implementation details in the body
- Specify exact file paths to create or modify
- Include function signatures, types, interfaces
- Don't reference "the previous task" - include the context

**3. Include in the body**
- Implementation details with file paths
- Testing instructions (specific commands)
- Acceptance criteria (how to verify completion)
- `**Depends on #N**` for any dependencies

**4. Identify dependencies**
- Which items must complete before this one can start?
- Only add dependencies that are truly required
- More independent items = more parallelism

---

Output a JSON array where each item has:
- "id": number (starting from 1)
- "title": string (short title)
- "body": string (full implementation details, file paths, acceptance criteria)
- "dependencies": number[] (IDs of prerequisite work items)

RESPOND WITH ONLY THE JSON ARRAY. Example format:
[{"id":1,"title":"First task","body":"Details...","dependencies":[]},{"id":2,"title":"Second task","body":"Details...","dependencies":[1]}]

DO NOT include any text before or after the JSON. DO NOT use markdown code blocks. ONLY output the JSON array.
