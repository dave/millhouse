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
- `[name]` - Optional plan name. If provided, saves as `millhouse-plan-{name}.json`. If omitted, saves as `millhouse-plan.json`.

**Input:** Reads from `plan.md` in the current directory, or ask for the filename if not found.

### Instructions

1. Read the plan from `plan.md` or ask for the filename
2. Break the plan into discrete work items
3. Identify dependencies between work items
4. Output a JSON file with the analyzed plan

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
      "body": "Full implementation details...\n\n**Depends on #1**\n\n## Implementation\n...",
      "dependencies": [1]
    }
  ]
}
```

### Work Item Requirements

Each work item body MUST include:

**Implementation Details**
- Specific file paths to create or modify
- Function signatures, types, or interfaces
- Libraries or patterns to use

**Testing & Verification**
- Commands to verify the implementation
- Expected output or behavior

**Acceptance Criteria**
- Clear checkable criteria for completion
- Edge cases to handle

**Dependencies** (in body text)
- `**Depends on #N**` if it depends on another item
- What it needs from that dependency

### Important Guidelines

- **Be non-interactive** - don't ask questions, just analyze and output
- **Make each item self-contained** - include ALL context needed
- **Split appropriately** - not too big (entire app) or too small (trivial function)
- **Dependencies must be by ID** - use the numeric ID in the dependencies array

---

## /millhouse issues

Create GitHub issues from a JSON plan file.

**Arguments:**
- `[name]` - Optional plan name. Loads `millhouse-plan-{name}.json` or `millhouse-plan.json` if omitted.

### Instructions

1. Load the JSON plan file (`millhouse-plan.json` or `millhouse-plan-{name}.json`)
2. If not found, tell the user to run `/millhouse plan` first
3. Create GitHub issues from the plan items using `gh issue create`
4. Create issues in dependency order (no-dependency items first)
5. Update the JSON plan with the actual GitHub issue numbers
6. After creating all issues, create an **index issue**

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
