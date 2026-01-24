# Millhouse

Orchestrate parallel Claude Code instances to implement work items.

## Usage

Parse $ARGUMENTS to determine the subcommand:

- `/millhouse plan [name]` - Analyze a plan and save as JSON for fast execution
- `/millhouse issues [name]` - Create GitHub issues from a JSON plan

---

## /millhouse plan

Convert a markdown plan to JSON and write `millhouse-plan.json`.

**Output file:** `millhouse-plan.json` (or `millhouse-plan-{name}.json` if name argument given)

**Output format:** JSON (not markdown!)

### Instructions

1. Find the plan in ~/.claude/plans/ (most recent .md file)
2. Parse each task/section into a JSON work item
3. Write the JSON file to the project root:

```
Write millhouse-plan.json with content:
{
  "version": 1,
  "createdAt": "<ISO timestamp>",
  "items": [
    {"id": 1, "title": "...", "body": "...", "dependencies": []},
    {"id": 2, "title": "...", "body": "...", "dependencies": [1]}
  ]
}
```

**DO NOT:**
- Copy the markdown file
- Say "the plan is already ready"
- Skip writing the JSON file

**DO:**
- Parse the markdown into JSON structure
- Write `millhouse-plan.json` with the JSON content

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

### Checklist before finishing

- [ ] Did you write a file named `millhouse-plan.json`?
- [ ] Is the file content JSON (not markdown)?
- [ ] Does it have `"version": 1` and an `"items"` array?

If any answer is NO, go back and fix it.

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
