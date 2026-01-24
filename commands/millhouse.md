# Millhouse

Orchestrate parallel Claude Code instances to implement work items.

## Usage

Parse $ARGUMENTS to determine the subcommand:

- `/millhouse plan [name]` - Analyze a plan and save as JSON for fast execution
- `/millhouse issues [name]` - Create GitHub issues from a JSON plan

---

## /millhouse plan

Analyze a plan, extract work items with dependencies, and save as JSON for fast execution by `millhouse run`.

**Arguments:**
- `[name]` - Optional OUTPUT name for the JSON file. NOT an input file.
  - `/millhouse plan` → saves `millhouse-plan.json`
  - `/millhouse plan foo` → saves `millhouse-plan-foo.json`

**Input:** Use the current plan from this conversation. If no plan has been discussed, output an error and exit.

### Critical Context

These work items will be executed by **parallel Claude Code instances**, each running **unattended in its own isolated context window**. This means:

- Each work item runs in a fresh context with NO memory of other work items
- Work items must be completely self-contained with ALL context needed
- Nothing can be assumed or left implicit
- Multiple items with no dependencies will run simultaneously

### Instructions

1. Get the plan from the current conversation. If no plan exists, output an error and stop.
2. Break the plan into discrete, parallelizable work items
3. Identify dependencies between work items
4. **IMPORTANT: Write the JSON file to the project root using the Write tool**
   - No name argument: write to `millhouse-plan.json`
   - With name argument: write to `millhouse-plan-{name}.json`

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

### Important

- **Be non-interactive** - don't ask questions, just analyze and output the JSON file
- **Don't suggest additions** - only restructure and clarify what's in the plan
- **Make reasonable assumptions** - if something is ambiguous, decide and note it in the item

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
