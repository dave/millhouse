# Millhouse

Orchestrate parallel Claude Code instances to implement work items.

## Usage

Parse $ARGUMENTS to determine the subcommand:

- `/millhouse issues [plan-file]` - Create GitHub issues from a plan
- `/millhouse local [plan.md] [output.json]` - Create local work items file from a plan
- `/millhouse status` - Show run status

---

## /millhouse issues

Convert a plan into GitHub issues formatted for Millhouse.

### Critical Context

These issues will be implemented by Claude Code instances running **unattended in separate context windows**. Each issue is a fresh start with no memory of previous conversations. This means:

- Every issue must be completely self-contained
- All relevant context, requirements, and constraints must be explicitly stated
- Nothing can be assumed or left implicit

### Instructions

1. Read the plan from the file path argument, or ask the user to describe it
2. Break it into discrete, implementable issues
3. For each issue, identify dependencies on other issues
4. Create issues in order using `gh issue create`, starting with issues that have no dependencies
5. Use the actual issue numbers returned by GitHub for dependency references
6. After creating all issues, create an **index issue** that lists them all (see below)

### Issue Content Requirements

Each issue MUST include:

**Implementation Details**
- Specific file paths to create or modify
- Function signatures, types, or interfaces expected
- Any specific libraries or patterns to use

**Testing & Verification**
- How to verify the implementation works
- Specific test commands to run (e.g., `npm test`, `npm run build`)
- Expected output or behavior

**Acceptance Criteria**
- Clear, checkable criteria for when the issue is "done"
- Edge cases to handle
- Error conditions to consider

**Dependencies**
- `**Depends on #N**` if it depends on another issue
- What specifically it needs from that dependency (files, exports, etc.)

### Example Issue Body

```markdown
Create `src/utils/math.ts` with basic arithmetic functions.

## Implementation
- Export functions: `add(a: number, b: number): number` and `multiply(a: number, b: number): number`
- Use ES module syntax (export, not module.exports)
- No external dependencies

## Testing
Run `npx tsc --noEmit` to verify no type errors.

## Acceptance Criteria
- [ ] File exists at `src/utils/math.ts`
- [ ] Both functions are exported
- [ ] TypeScript compiles without errors
```

### Index Issue

After creating all implementation issues, create a final **index issue** that serves as an overview. Title it something like "Implement [feature name]" and include:

- A one-line summary of the overall goal
- A list of all created issues with their numbers and a brief description
- The command to run: `millhouse run --issue <index-number>`

Example:

```markdown
Implement a calculator library with math utilities.

## Issues

- #1 Create math utilities (`src/utils/math.ts`)
- #2 Create string helpers (`src/utils/string.ts`)
- #3 Create calculator class (`src/calculator.ts`)
- #4 Create main entry point (`src/index.ts`)

## Run

\`\`\`bash
millhouse run --issue <this-issue-number>
\`\`\`
```

The index issue should **not** include detailed dependency information—Millhouse will discover dependencies from the individual issues.

---

## /millhouse local

Convert a plan into a local JSON file for Millhouse (no GitHub required).

### Critical Context

Same as `/millhouse issues` - work items will be implemented by Claude Code instances running **unattended in separate context windows**.

### Instructions

1. Parse arguments by extension:
   - `.json` file = output filename (default: `millhouse-work.json`)
   - Any other file = plan file to read from
   - Examples: `/millhouse local` `/millhouse local plan.md` `/millhouse local output.json` `/millhouse local plan.md output.json`
2. Read the plan from the plan file, or ask the user to describe it
3. Break it into discrete, implementable items
4. For each item, identify dependencies on other items
5. Create the JSON file with all work items

### JSON File Format

Create the output file (default `millhouse-work.json`):

```json
{
  "version": 1,
  "name": "Feature name",
  "description": "Brief description of the overall goal",
  "createdAt": "2024-01-15T10:00:00Z",
  "items": [
    {
      "id": 1,
      "title": "Create math utilities",
      "body": "Full description with implementation details, testing, and acceptance criteria..."
    },
    {
      "id": 2,
      "title": "Create calculator",
      "body": "Full description...\n\n**Depends on #1**",
      "dependencies": [1]
    }
  ]
}
```

### Work Item Content Requirements

Same as GitHub issues - the body should include:
- Implementation details (file paths, function signatures)
- Testing & verification instructions
- Acceptance criteria

The `dependencies` array is optional - if omitted, the item has no dependencies.

### After Creating the File

Tell the user to run (using the actual filename):
```bash
millhouse run --file <filename.json>
```

---

## /millhouse status

Run `millhouse status` to show the status of current and past runs.
