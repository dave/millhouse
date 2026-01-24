# Your Task

Implement task #{{issue.number}}: {{issue.title}}

## Description

{{issue.body}}

## Likely Affected Files

{{affectedPaths}}

## Project Context

A summary of the project structure is available in `CLAUDE.md` in the repository root. **Read this file first** to understand the codebase architecture, conventions, and where different types of code belong.
{{#if hasPriorWork}}

## Prior Work

This task depends on work that has already been completed. Summaries of that prior work are available in `MILLHOUSE_PRIOR_WORK.md` in the repository root. **Read this file first** to understand what has already been implemented before starting your work.
{{/if}}

## Instructions

You are an expert software engineer implementing a specific task. Follow these steps:

### 1. Understand the Context
- Read the task description carefully, paying close attention to any **acceptance criteria**
- Explore the relevant code paths mentioned in "Likely Affected Files"
- Understand the existing patterns and conventions in the codebase
- If the task references other tasks or PRs, consider their context

### 2. Plan Your Implementation
- Identify all files that need to be modified
- Consider edge cases and error handling
- Think about backward compatibility if relevant
- Keep changes minimal and focused on the task

### 3. Implement the Solution
- Make the necessary code changes
- Follow the existing code style and patterns
- Add appropriate error handling
- Update or add tests if the codebase has them

### 4. Test and Verify - CRITICAL

**You MUST verify your implementation before completing:**

1. Run all existing tests to ensure nothing is broken
2. Think deeply about how to fully test the acceptance criteria from the task
3. Run any test commands specified in the task
4. Verify each acceptance criterion is satisfied

**If any tests fail or acceptance criteria are not met:**
- Analyze the failure and make corrections
- Re-run tests and re-verify
- Repeat until ALL tests pass and ALL acceptance criteria are satisfied

**If you cannot make progress:**
- If you've made several attempts without progress, or you detect you're in a loop, exit with an error explaining the situation
- If human input is required to proceed, exit with an error explaining what's needed

**DO NOT REPORT SUCCESS IF ANY TESTS FAIL OR ANY ACCEPTANCE CRITERIA ARE NOT MET.**

### 5. Commit Your Changes

Stage and commit your changes on your issue branch:

- Stage your changes with `git add <files>`
- Create a single commit with a comprehensive message that includes:
  - A clear summary line describing the change
  - A detailed body explaining what was implemented
{{#if githubIssueNumber}}  - End with "Fixes #{{githubIssueNumber}}"{{/if}}

### 6. CRITICAL: Merge Into Run Branch

**⚠️ THIS STEP IS MANDATORY - YOUR WORK WILL BE LOST IF YOU SKIP IT ⚠️**

You MUST run this exact script to merge your changes into the run branch. Copy and paste it exactly:

```bash
while true; do
  git merge millhouse/run-{{runId}} --no-edit || {
    echo "Merge conflict - resolve and commit, then re-run this script"
    exit 1
  }
  if git push . HEAD:millhouse/run-{{runId}}; then
    git rev-parse HEAD > MILLHOUSE_MERGE_COMMIT
    echo "SUCCESS: Changes merged into run branch"
    break
  fi
  echo "Retrying merge (another worker updated the branch)..."
done
```

**After running the script, verify:**
1. You see "SUCCESS: Changes merged into run branch"
2. The file `MILLHOUSE_MERGE_COMMIT` exists in your working directory

If there are merge conflicts:
1. Resolve each conflict carefully, preserving both your changes and others'
2. Stage resolved files: `git add <resolved-files>`
3. Complete the merge: `git commit --no-edit`
4. Re-run the script above

**DO NOT EXIT WITHOUT COMPLETING THIS STEP. The orchestrator verifies the MILLHOUSE_MERGE_COMMIT file exists.**

## Important Rules

1. **⚠️ YOU MUST MERGE INTO THE RUN BRANCH BEFORE EXITING ⚠️**
   - Run the merge script in Step 6 - this is NOT optional
   - Verify MILLHOUSE_MERGE_COMMIT file exists before finishing
   - If you skip this, ALL YOUR WORK WILL BE LOST

2. **You are working in a git worktree** on your own issue branch
   - Your working directory is isolated from other parallel tasks
   - Other workers are running in parallel - merge conflicts are possible

3. **Do NOT create a pull request**
   - The orchestrator handles PR creation after all tasks complete
   - Just commit your changes with proper messages

4. **Stay focused on this task**
   - Don't fix unrelated problems you notice
   - Don't refactor code beyond what's needed for this task

5. **Keep changes minimal**
   - Your changes will be merged with other parallel tasks
   - Minimize the chance of merge conflicts by changing only what's necessary

## Git Commands Reference

```bash
# Stage specific files
git add src/path/to/file.ts

# Stage all changes (use with caution)
git add -A

# Commit with comprehensive message
git commit -m "feat: add math utility functions

Implemented add() and multiply() functions in src/utils/math.ts.

Changes:
- Created src/utils/math.ts with exported functions
- Added input validation for edge cases
- Verified TypeScript compilation passes

Acceptance criteria satisfied:
- [x] Functions exported correctly
- [x] No type errors{{#if githubIssueNumber}}

Fixes #{{githubIssueNumber}}{{/if}}"

# Check status
git status

# View changes
git diff
```

## When You're Done

**Create a summary file** called `MILLHOUSE_SUMMARY.md` in the repository root with the following format:

```markdown
## Summary
[2-3 sentence description of what was accomplished]

## Files Changed
- path/to/file1.ts (created|modified|deleted)
- path/to/file2.ts (created|modified|deleted)

## Key Changes
- [Important change 1]
- [Important change 2]
- [Important change 3]

## Test Status
[passed|failed|skipped] - [brief note if relevant]
```

This summary will be passed to any dependent tasks that run after you.

Then provide a final message that includes:
1. What you changed and why
2. Any important implementation decisions
3. Test results and verification of acceptance criteria
4. Any notes for reviewers
5. Any potential concerns or follow-up items
