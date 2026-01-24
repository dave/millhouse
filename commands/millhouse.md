# Millhouse

Orchestrate parallel Claude Code instances to implement work items.

## Usage

Parse $ARGUMENTS to determine the subcommand:

- `/millhouse plan [name]` - Analyze a plan and save as JSON for fast execution
- `/millhouse issues [name]` - Create GitHub issues from a JSON plan

---

## /millhouse plan

**Your ONLY job: Convert the current plan to JSON format and write it to a file.**

Do NOT evaluate whether the plan is "ready" or "good enough". Do NOT skip writing the file. ALWAYS write the JSON file.

**Arguments:**
- `[name]` - Optional name for the output JSON file.
  - `/millhouse plan` → write `millhouse-plan.json`
  - `/millhouse plan foo` → write `millhouse-plan-foo.json`

### Instructions

1. Find the current plan in this conversation (check ~/.claude/plans/ or recent messages)
2. If no plan exists, output an error: "No plan found in conversation" and stop
3. Convert the plan to JSON format (see format below)
4. **ALWAYS write the JSON file using the Write tool** - this is required, not optional

### Context for work items

The work items will be executed by **parallel Claude Code instances** in **isolated contexts**:
- Each runs in a fresh context with NO memory of other items
- Items must be completely self-contained
- Multiple items without dependencies run simultaneously

### Work Item Guidelines

**1. Size appropriately**
- Each item should be completable in one unattended session
- "Create an entire application" is too big - break it down
- "Add a single line" might be too small (unless it's a dependency)

**2. Make self-contained**
- Include ALL implementation details - file paths, function signatures, types
- Don't say "use the function from task 1" - describe what function and its signature
- Include enough context that someone with no memory of other tasks could implement it

**3. Maximize parallelism**
- Only add dependencies that are truly required
- If two items could theoretically run at the same time, don't add a dependency
- More independent items = faster execution

**4. Each body MUST include**
- **Implementation details** with specific file paths
- **Testing instructions** (specific commands to run)
- **Acceptance criteria** (how to verify completion)
- `**Depends on #N**` if it depends on another item (explain what it needs)

### Output Format

Save to `millhouse-plan.json` (or `millhouse-plan-{name}.json` if name provided):

```json
{
  "version": 1,
  "name": "optional-name",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "sourcePlan": "plan.md",
  "items": [
    {
      "id": 1,
      "title": "Initialize TypeScript Project",
      "body": "Full implementation details...\n\n## Implementation\n...\n\n## Testing\n...\n\n## Acceptance Criteria\n...",
      "dependencies": []
    },
    {
      "id": 2,
      "title": "Create Math Utilities",
      "body": "**Depends on #1** - needs the TypeScript project structure.\n\nFull implementation details...\n\n## Implementation\n...",
      "dependencies": [1]
    }
  ]
}
```

### CRITICAL

- **ALWAYS write the JSON file** - this is the entire point of this command
- **Never skip writing** - even if the plan "looks ready", you must write the JSON
- **Don't evaluate** - don't say "the plan is already good" - just convert and write
- **Be non-interactive** - don't ask questions, just convert and write the file

---

## /millhouse issues

Create GitHub issues from a JSON plan file.

**Arguments:**
- `[name]` - Optional name to identify which JSON plan to load.
  - `/millhouse issues` → loads `millhouse-plan.json`
  - `/millhouse issues foo` → loads `millhouse-plan-foo.json`

### Instructions

1. Load the JSON plan file (`millhouse-plan.json` or `millhouse-plan-{name}.json`)
2. If not found, tell the user to run `/millhouse plan` first
3. Create GitHub issues from the plan items using `gh issue create`
4. Create issues in dependency order (no-dependency items first)
5. After creating all issues, create an **index issue**

### Important: Dependency Mapping

The JSON plan has internal IDs (1, 2, 3...) but GitHub will assign different issue numbers.

When creating issues:
1. Create issues with no dependencies first
2. Track the mapping: internal ID → GitHub issue number
3. When creating dependent issues, replace `**Depends on #N**` with actual GitHub issue number

### Index Issue

After creating all implementation issues, create a final **index issue**:

```markdown
Implement [feature name from plan]

## Issues

- #101 Create math utilities
- #102 Create string helpers
- #103 Create calculator class (depends on #101, #102)

## Run

\`\`\`bash
millhouse run issues <this-issue-number>
\`\`\`
```
