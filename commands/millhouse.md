# Millhouse

Orchestrate parallel Claude Code instances to implement work items.

## Usage

Parse $ARGUMENTS to determine the subcommand:

- `/millhouse plan [plan-file]` - Refine a plan for millhouse execution
- `/millhouse issues [plan-file]` - Create GitHub issues from a plan

---

## /millhouse plan

Refine and improve a plan to make it suitable for millhouse execution. This should be fast and unattended - don't ask clarifying questions, just improve the plan.

### Context

Millhouse executes work items in **parallel using separate Claude Code instances**, each running **unattended in its own context window**. This means:

- Each work item is a fresh start with no memory of previous work
- Work items must be completely self-contained
- Nothing can be assumed or left implicit

### Instructions

1. Read the plan from the file path argument. If no file given, look for plan.md or ask for the filename only.
2. Analyze the plan and rewrite it following the guidelines below
3. Save the improved plan to the same file (overwrite), or `plan.md` if it was a new plan
4. **Do not ask questions about features, scope, or implementation details** - work with what's given
5. **Do not suggest additions** - only restructure and clarify what's already in the plan

### Plan Improvement Guidelines

Transform the plan to be millhouse-ready:

**1. Separate work items clearly**
- Each work item should be a distinct section
- Work items will run in separate contexts, stage by stage
- Make boundaries between items obvious

**2. Split into appropriately-sized tasks**
- Break large tasks into smaller sub-tasks where necessary
- Each task should be small enough to complete in one go, unattended
- A task that's "create an entire application" is too big
- A task that's "create a function that adds two numbers" might be too small (unless it's a dependency)

**3. Make each task self-contained**
- Include ALL context needed to implement the task
- Specify exact file paths to create or modify
- Include function signatures, types, interfaces
- Don't assume knowledge from other tasks

**4. Add thorough acceptance criteria**
- How do we know this task is done?
- What commands verify it works? (e.g., `npm test`, `go build`)
- What should the output look like?
- What edge cases should be handled?

**5. Add testing instructions**
- Specific test commands to run
- Expected results
- How to verify integration with other components

**6. Make dependencies explicit**
- Which tasks must complete before this one can start?
- What does this task need from its dependencies? (files, exports, etc.)
- Use clear language like "This requires the math utilities from task 1"

### Important: Be Non-Interactive

- **Don't ask** if the user wants to add features, tests, or documentation
- **Don't suggest** expanding scope or adding "nice to haves"
- **Just restructure** the existing plan into millhouse-ready format
- If something is ambiguous, make a reasonable assumption and note it in the task

### Example Transformation

**Before (too vague):**
```markdown
# My App
- Build a calculator
- Add tests
```

**After (millhouse-ready):**
```markdown
# Calculator App

## 1. Initialize TypeScript Project
Create the project structure with TypeScript configuration.

### Implementation
- Create `package.json` with name "calculator", typescript and vitest as dev dependencies
- Create `tsconfig.json` with strict mode, ES2020 target, NodeNext module resolution
- Create `src/` directory

### Testing
Run `npm install` and `npx tsc --noEmit` - should complete without errors.

### Acceptance Criteria
- [ ] `package.json` exists with correct dependencies
- [ ] `tsconfig.json` exists with strict mode enabled
- [ ] `src/` directory exists
- [ ] `npm install && npx tsc --noEmit` succeeds

## 2. Create Math Utilities
Create basic arithmetic functions used by the calculator.

**Depends on task 1** - needs the TypeScript project structure.

### Implementation
Create `src/math.ts` with:
- `add(a: number, b: number): number` - returns sum
- `subtract(a: number, b: number): number` - returns difference
- `multiply(a: number, b: number): number` - returns product
- `divide(a: number, b: number): number` - returns quotient, throws on division by zero

### Testing
Create `src/math.test.ts` with vitest tests for all functions including edge cases.
Run `npx vitest run` - all tests should pass.

### Acceptance Criteria
- [ ] `src/math.ts` exports all four functions
- [ ] `src/math.test.ts` has tests for each function
- [ ] Tests cover division by zero error case
- [ ] `npx vitest run` passes all tests
```

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
- The command to run: `millhouse run issues <index-number>`

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
millhouse run issues <this-issue-number>
\`\`\`
```

The index issue should **not** include detailed dependency information—Millhouse will discover dependencies from the individual issues.
