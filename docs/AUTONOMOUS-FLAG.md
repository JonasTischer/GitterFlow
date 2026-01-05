# Design Document: `--autonomous` Flag Implementation

## Overview

Add an `--autonomous` flag to `gf new` that tracks agent state and enables agent-controlled completion. When this flag is used, the spawned agent is responsible for signaling its own completion by running `gf finish`.

### Current State

The `gf new` command already supports:
- Creating worktrees with optional branch names
- Pre-trusting worktrees in `~/.claude.json`
- Passing tasks via `--task/-t` flag
- Spawning a terminal with the coding agent

### Goal

Extend `gf new` to:
1. Track autonomous agent state in `.gitterflow/agents/`
2. Inject completion instructions into the task prompt
3. Enable agents to update their status via `gf status --write`

---

## Design Philosophy

### Agent-Controlled Completion

The `--autonomous` flag follows an **agent-controlled completion** model rather than shell command chaining.

**Why not shell chaining (e.g., `claude "task" && gf finish`)?**

| Approach | Problem |
|----------|---------|
| Shell chaining | Exit code doesn't reflect task success; only command execution |
| Shell chaining | Agent can't update status messages during execution |
| Shell chaining | Complex escaping required for nested quotes |
| Shell chaining | No way to handle partial completion or conflicts |

**Benefits of agent-controlled completion:**

1. **Agent decides when done** - The agent has full context to determine task completion
2. **Status updates** - Agent can write progress updates via `gf status --write`
3. **No shell escaping** - Task prompt passed cleanly without escaping concerns
4. **Leverages gitterflow skill** - The `.claude/skills/gitterflow/SKILL.md` already instructs agents to run `gf finish`
5. **Graceful failure handling** - Agent can report failures with context before finishing

### Completion Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        gf new --autonomous                        │
├──────────────────────────────────────────────────────────────────┤
│  1. Create worktree                                               │
│  2. Pre-trust in ~/.claude.json                                   │
│  3. Write agent state (status: running)                           │
│  4. Append completion reminder to task                            │
│  5. Spawn terminal with agent                                     │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Agent Execution                            │
├──────────────────────────────────────────────────────────────────┤
│  - Agent works on task                                            │
│  - Optional: gf status --write "progress message"                 │
│  - Agent runs: gf snap (commit work)                              │
│  - Agent runs: gf finish (merge and cleanup)                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                        gf finish                                  │
├──────────────────────────────────────────────────────────────────┤
│  1. Commit uncommitted changes                                    │
│  2. Merge to base branch                                          │
│  3. Update agent state (status: merged/conflict/failed)           │
│  4. Cleanup worktree                                              │
└──────────────────────────────────────────────────────────────────┘
```

---

## What `--autonomous` Does

### Flags

```
gf new [branch] --autonomous [--task "description"]
gf new [branch] -a [-t "description"]
```

### Behavior

When `--autonomous` is specified:

1. **Creates worktree** (existing behavior)
2. **Pre-trusts in `~/.claude.json`** (existing behavior)
3. **Writes initial agent state** to `.gitterflow/agents/BRANCH.yaml`:
   ```yaml
   branch: feature-foo
   task: "Implement user authentication"
   status: running
   started_at: "2024-01-15T10:30:00Z"
   worktree_path: "/Users/dev/worktrees/feature-foo"
   base_branch: main
   ```
4. **Appends completion reminder** to task prompt:
   ```
   [Original task]

   ---
   IMPORTANT: When you have completed this task, run `gf snap` to commit your
   changes, then run `gf finish` to merge your work back to the base branch.
   ```
5. **Spawns terminal** with the agent (existing behavior)

### Task Prompt Injection

The completion reminder is appended to ensure agents (even without the gitterflow skill loaded) know how to signal completion:

```typescript
const autonomousReminder = `

---
IMPORTANT: When you have completed this task, run \`gf snap\` to commit your
changes, then run \`gf finish\` to merge your work back to the base branch.`;

const finalTask = autonomous ? task + autonomousReminder : task;
```

---

## New Command: `gf status --write`

### Purpose

Allow agents to update their status message during execution.

### Usage

```bash
gf status --write "Implementing authentication middleware"
gf status -w "Running tests"
```

### Behavior

1. **Detects current branch** from git
2. **Reads existing agent state** from `.gitterflow/agents/BRANCH.yaml`
3. **Updates message field** with provided text
4. **Writes updated state** back to YAML file

### Error Cases

| Case | Behavior |
|------|----------|
| No agent state file | Exit with error: "No autonomous agent found for branch 'X'" |
| Not in worktree | Exit with error: "Not in a git repository" |
| No message provided | Exit with error: "Message required with --write flag" |

---

## Files to Modify

### 1. `src/commands/new.ts`

**Changes:**
- Add `--autonomous/-a` flag parsing
- Write initial agent state when flag present
- Append completion reminder to task prompt

**Code locations:**

```typescript
// In parseArgs() - add autonomous flag
function parseArgs(args: string[]): {
  branch: string | undefined;
  task: string | undefined;
  force: boolean;
  autonomous: boolean;  // NEW
}

// After worktree creation, before terminal spawn
if (autonomous) {
  await writeAgentState({
    branch,
    task: task || "No task specified",
    status: "running",
    started_at: new Date().toISOString(),
    worktree_path: worktreePath,
    base_branch: baseBranch,
  });
}

// Modify task before passing to buildAgentCommand()
const finalTask = autonomous && task
  ? task + AUTONOMOUS_REMINDER
  : task;
```

### 2. `src/commands/status.ts`

**Changes:**
- Add `--write/-w` flag parsing
- Implement write mode that updates agent state message

**Code structure:**

```typescript
// New function for write mode
async function writeStatusMessage(
  message: string,
  context: CommandContext
): Promise<number> {
  const branch = await getCurrentBranch(exec);
  const state = await readAgentState(branch);

  if (!state) {
    stderr(`No autonomous agent found for branch '${branch}'`);
    return 1;
  }

  await writeAgentState({
    ...state,
    message,
  });

  stdout(`Status updated for ${branch}`);
  return 0;
}

// In run() - check for --write flag first
const writeIndex = args.findIndex(a => a === "--write" || a === "-w");
if (writeIndex !== -1) {
  const message = args[writeIndex + 1];
  if (!message || message.startsWith("-")) {
    stderr("Message required with --write flag");
    return 1;
  }
  return writeStatusMessage(message, context);
}
```

### 3. `src/utils/agent-state.ts`

**Changes:**
- Add `message` field to `AgentState` interface

**Updated interface:**

```typescript
export interface AgentState {
  branch: string;
  task: string;
  status: AgentStatus;
  started_at: string;
  completed_at?: string;
  worktree_path: string;
  base_branch: string;
  error?: string;
  message?: string;  // NEW - status message from agent
}
```

### 4. `src/commands/finish.ts`

**Changes:**
- Update agent state on completion (merged, conflict, or failed)

**Code locations:**

```typescript
// After successful merge
await updateAgentStatus(branch, "merged");

// On merge conflict
await updateAgentStatus(branch, "conflict", undefined, {
  error: "Merge conflict detected. Resolve conflicts and run gf finish again.",
});

// On failure
await updateAgentStatus(branch, "failed", undefined, {
  error: errorMessage,
});
```

---

## Implementation Order

Follow this order to enable incremental testing:

### Phase 1: Agent State Enhancement
1. **`src/utils/agent-state.ts`** - Add `message` field to interface
2. Write tests for new field serialization

### Phase 2: Status Write Command
3. **`src/commands/status.ts`** - Add `--write` flag support
4. Write tests for write mode

### Phase 3: New Command Enhancement
5. **`src/commands/new.ts`** - Add `--autonomous` flag
6. Write tests for autonomous mode

### Phase 4: Finish Command Integration
7. **`src/commands/finish.ts`** - Update agent state on completion
8. Write integration tests

---

## Testing Strategy

### Unit Tests

#### `agent-state.test.ts`

```typescript
describe("AgentState with message", () => {
  test("should write and read message field", async () => {
    const state: AgentState = {
      branch: "test-branch",
      task: "Test task",
      status: "running",
      started_at: new Date().toISOString(),
      worktree_path: "/tmp/test",
      base_branch: "main",
      message: "Working on authentication",
    };

    await writeAgentState(state, tmpDir);
    const read = await readAgentState("test-branch", tmpDir);

    expect(read?.message).toBe("Working on authentication");
  });
});
```

#### `status.test.ts`

```typescript
describe("gf status --write", () => {
  test("should update agent message", async () => {
    // Setup: create initial agent state
    await writeAgentState({...initialState}, tmpDir);

    // Execute: run status --write
    const result = await run({
      args: ["--write", "New status message"],
      ...mockContext,
    });

    // Verify: check updated state
    const state = await readAgentState("test-branch", tmpDir);
    expect(state?.message).toBe("New status message");
  });

  test("should error when no agent state exists", async () => {
    const { stderr } = commandIO();
    const result = await run({
      args: ["--write", "Message"],
      stderr,
      ...mockContext,
    });

    expect(result).toBe(1);
    expect(stderr.mock.calls[0][0]).toContain("No autonomous agent found");
  });
});
```

#### `new.test.ts`

```typescript
describe("gf new --autonomous", () => {
  test("should write initial agent state", async () => {
    await run({
      args: ["feature-test", "--autonomous", "--task", "Test task"],
      ...mockContext,
    });

    const state = await readAgentState("feature-test", tmpDir);
    expect(state).toBeDefined();
    expect(state?.status).toBe("running");
    expect(state?.task).toBe("Test task");
  });

  test("should append completion reminder to task", async () => {
    let capturedCommand = "";
    const mockExec = captureExec({
      // Capture the claude command
    });

    await run({
      args: ["--autonomous", "--task", "Original task"],
      exec: mockExec,
      ...mockContext,
    });

    expect(capturedCommand).toContain("gf snap");
    expect(capturedCommand).toContain("gf finish");
  });
});
```

#### `finish.test.ts`

```typescript
describe("gf finish with autonomous agent", () => {
  test("should update agent state to merged on success", async () => {
    // Setup: create running agent state
    await writeAgentState({
      branch: "feature-test",
      status: "running",
      ...otherFields,
    }, tmpDir);

    // Execute: run finish
    await run({...mockContext});

    // Verify: state is merged
    const state = await readAgentState("feature-test", tmpDir);
    expect(state?.status).toBe("merged");
    expect(state?.completed_at).toBeDefined();
  });

  test("should update agent state to conflict on merge failure", async () => {
    // Setup: mock merge conflict
    const mockExec = captureExec({
      "git merge": () => { throw new Error("CONFLICT"); },
    });

    await run({exec: mockExec, ...mockContext});

    const state = await readAgentState("feature-test", tmpDir);
    expect(state?.status).toBe("conflict");
    expect(state?.error).toContain("conflict");
  });
});
```

### Integration Tests

```typescript
describe("autonomous agent workflow", () => {
  test("full workflow: new -> status --write -> finish", async () => {
    // 1. Create autonomous worktree
    await newCommand.run({
      args: ["test-feature", "--autonomous", "--task", "Test"],
      ...context,
    });

    // 2. Verify initial state
    let state = await readAgentState("test-feature");
    expect(state?.status).toBe("running");

    // 3. Update status
    await statusCommand.run({
      args: ["--write", "Halfway done"],
      ...context,
    });

    state = await readAgentState("test-feature");
    expect(state?.message).toBe("Halfway done");

    // 4. Finish
    await finishCommand.run({...context});

    state = await readAgentState("test-feature");
    expect(state?.status).toBe("merged");
  });
});
```

---

## Edge Cases

### `gf new --autonomous`

| Case | Expected Behavior |
|------|-------------------|
| No `--task` provided | Write state with `task: "No task specified"` |
| Worktree creation fails | Don't write agent state, return error |
| `.gitterflow/agents/` doesn't exist | Create directory before writing |
| Branch name with slashes | Sanitize to dashes in filename |

### `gf status --write`

| Case | Expected Behavior |
|------|-------------------|
| No agent state for branch | Error: "No autonomous agent found" |
| Empty message | Error: "Message required" |
| Message with special chars | Properly escape in YAML |
| Agent already completed | Allow update (may be useful for notes) |

### `gf finish` with agent state

| Case | Expected Behavior |
|------|-------------------|
| No agent state exists | Skip state update (non-autonomous worktree) |
| Merge conflict | Set status to "conflict", preserve worktree |
| Git error | Set status to "failed" with error message |
| Successful merge | Set status to "merged", set `completed_at` |

---

## Status Display Enhancement

Update `gf status` table to show message when present:

```
Branch                    Status       Task                      Message              Started
─────────────────────────────────────────────────────────────────────────────────────────────
feature-auth              running      Add OAuth support         Running tests        2 min ago
feature-ui                running      Update dashboard          Fixing CSS           5 min ago
bugfix-login              completed    Fix login redirect                             1 hour ago
```

**Column widths update:**

```typescript
const COLUMN_WIDTHS = {
  branch: 25,
  status: 12,
  task: 25,
  message: 20,  // NEW
  started: 12,
};
```

---

## Backward Compatibility

- Existing worktrees without agent state continue to work
- `gf finish` on non-autonomous worktrees skips state update
- `gf status` shows both autonomous and non-autonomous info gracefully
- `--autonomous` flag is opt-in, default behavior unchanged

---

## Future Considerations

Not in scope for this implementation, but worth noting:

1. **Timeout handling** - Auto-fail agents that exceed time limit
2. **Notification hooks** - Webhook/callback on state changes
3. **Agent restart** - Ability to restart failed agents
4. **Parallel status** - Show aggregated status across all agents
5. **Log capture** - Store agent output for debugging
