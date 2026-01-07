# GitterFlow Issues & Improvements

This document tracks known issues and planned improvements for GitterFlow.

---

## Issue 1: Merge Commit Messages Are Too Generic

**Status:** Open
**Priority:** Medium
**Location:** `src/commands/finish.ts:708`

### Problem

When `gf finish` runs, the merge commit message is generic:
```
Merge branch 'worktree-wise-tiger-435'
```

This provides no context about what was done in that branch.

### Root Cause

The merge command uses `--no-edit` with no custom message:
```typescript
await mergeRun`git merge ${currentBranch} --no-edit`;
```

### Proposed Solution

**Option A: Use agent task as merge message** (Recommended)
- Read the agent state from `.gitterflow/agents/{branch}.yaml`
- Use the `task` field to create a descriptive merge message
- Format: `Merge branch '{branch}': {task summary}`

**Option B: Generate summary from commits**
- Use `git log --oneline baseBranch..currentBranch` to get commit list
- Include commit summaries in merge message (similar to GitHub PR merge)

**Option C: AI-generated summary**
- Use the same OpenRouter API already in `generateCommitMessage()`
- Generate a comprehensive summary of the diff being merged

### Implementation Notes

The `AgentState` interface already includes:
- `task: string` - The task description
- `branch: string` - Branch name

For non-autonomous worktrees (no agent state), fall back to Option B or a simple enhanced message with commit count.

### Files to Modify

1. `src/commands/finish.ts` - Add merge message generation
2. `.claude/skills/gitterflow/SKILL.md` - Update docs if behavior changes

---

## Issue 2: Subagent Permission Inheritance

**Status:** Open
**Priority:** High
**Location:** `src/commands/new.ts:203`

### Problem

When spawning subagents via `gf new`, they lack permissions for many commands. Currently only:
```typescript
const flags = ["--permission-mode acceptEdits"];
```

The parent project's `.claude/settings.json` permissions are not inherited.

### Current `.claude/settings.json` Permissions

```json
{
  "permissions": {
    "allow": [
      "WebFetch(domain:bun.sh)",
      "Bash(bun --help test)",
      "Bash(bun test:*)",
      "WebSearch",
      "Bash(bun run test:unit)",
      "Bash(bun run check:*)",
      // ... more
    ]
  }
}
```

### Proposed Solution

**Option A: Copy settings.json to worktree** (Simple)
- During `gf new`, copy `.claude/settings.json` to the new worktree
- Add to `symlink_files` config or do explicitly
- Claude Code will then read the same permissions

**Option B: Symlink .claude directory**
- Add `.claude` to default `symlink_files` in config
- Worktree automatically gets same permissions via symlink

**Option C: Pass permissions via CLI flags** (Complex)
- Parse settings.json and convert to CLI flags
- Would need to map allow rules to appropriate CLI options
- Claude Code may not support all permission patterns via CLI

### Recommended Approach

Option A or B - symlink/copy the `.claude` directory:
1. Update default `symlink_files` in `config.ts` to include `.claude`
2. Or explicitly handle `.claude/settings.json` in `new.ts`

This ensures subagents inherit:
- All permission rules
- Project-specific settings
- Any hooks configured

### Files to Modify

1. `src/commands/new.ts` - Add .claude directory handling
2. `src/config.ts` - Consider adding `.claude` to default symlinks
3. `src/utils/claude-trust.ts` - May need to extend for permissions

---

## Issue 3: Brain-Subagent Orchestration Loop

**Status:** Open
**Priority:** High
**Location:** New feature

### Problem

There's no closed-loop communication between subagents and the orchestrating "brain" agent:

1. **No completion notification** - When a subagent finishes and runs `gf finish`, the brain doesn't know
2. **No input-needed notification** - When subagents are stuck on permission dialogs, brain can't help
3. **No continuation trigger** - Brain can't automatically resume to check merges and continue work

### Current Behavior

- Subagents run in separate terminals with no callback mechanism
- Brain has no way to "wake up" when work completes
- Human must manually check `gf status` and continue orchestration

### Desired Workflow

```
┌─────────────────────────────────────────────────────────────┐
│  BRAIN AGENT                                                │
│  ┌─────────┐     ┌─────────────┐     ┌──────────────────┐  │
│  │ Spawn   │────▶│ Wait/Sleep  │────▶│ Check status     │  │
│  │ workers │     │             │     │ Confirm merges   │  │
│  └─────────┘     └──────▲──────┘     │ Continue work    │  │
│                         │            └──────────────────┘  │
└─────────────────────────┼──────────────────────────────────┘
                          │ NOTIFY
┌─────────────────────────┼──────────────────────────────────┐
│  SUBAGENT 1             │          SUBAGENT 2              │
│  ┌─────────┐     ┌──────┴─────┐     ┌─────────┐           │
│  │ Work    │────▶│ gf finish  │     │ Work... │           │
│  │         │     │ Stop hook  │     │         │           │
│  └─────────┘     └────────────┘     └─────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Proposed Solution

#### Part A: Stop Hook Notification (Subagent → Brain)

Create a Claude Code stop hook in worktrees that notifies when agent exits:

```bash
# .claude/hooks/stop.sh (symlinked to worktree)
#!/bin/bash
# Update agent state and notify brain
gf status --write "completed"

# Signal brain via file touch or webhook
touch ../.gitterflow/brain-wake
```

Or via `.claude/settings.local.json`:
```json
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "gf finish && touch ../.gitterflow/brain-wake"
    }]
  }
}
```

#### Part B: Brain Wake Mechanism

**Option 1: File-based polling**
- Brain polls for `.gitterflow/brain-wake` or watches with inotify
- Simple, no external dependencies
- Brain skill instructions include: "After spawning workers, periodically check `gf status`"

**Option 2: Named pipe / FIFO**
- Create `.gitterflow/brain.pipe`
- Subagents write completion events to pipe
- Brain blocks on reading pipe

**Option 3: Webhook to brain's terminal**
- More complex, requires brain to expose endpoint
- Better for remote/distributed scenarios

#### Part C: Brain Continuation Logic

Update the GitterFlow skill (`.claude/skills/gitterflow/SKILL.md`) with brain instructions:

```markdown
## For Brain Agents: Orchestration Loop

After spawning subagents with `gf new --autonomous`:

1. **Monitor progress**: Run `gf status` periodically (every 30s-1min)
2. **On completion**: When agents show `merged` status:
   - Run `git pull` to get merged changes
   - Verify the implementation works (run tests, check functionality)
   - Update your task list, mark completed items
3. **On failure**: When agents show `failed` or `conflict`:
   - Check the error in `gf status` output
   - Decide: fix manually, spawn new agent, or escalate to human
4. **Continue**: With remaining tasks, spawn new agents or complete work yourself
```

#### Part D: Input-Needed Detection

For detecting when subagents are stuck on permission dialogs:

1. Add a `PreToolCall` hook that writes "waiting for permission: {tool}" to agent state
2. Brain sees `waiting_for_input` status and can intervene
3. Could also use Claude Code's `--allowedTools` to pre-approve

### Implementation Phases

**Phase 1: Manual polling** (Low effort)
- Update SKILL.md with brain orchestration instructions
- Brain manually runs `gf status` after spawning

**Phase 2: File-based wake** (Medium effort)
- Add stop hook that touches wake file
- Brain polls for wake file between tasks

**Phase 3: Full automation** (High effort)
- Implement FIFO or webhook system
- Brain blocks until notification received
- Add input-needed detection

### Proposed Config Addition

```yaml
# .gitterflow.yaml
orchestration:
  brain_wake_method: "file"  # file | fifo | webhook
  wake_file: ".gitterflow/brain-wake"
  poll_interval_seconds: 30

notifications:
  webhook_url: "https://..."  # Optional webhook for status changes
  notify_on:
    - merged
    - failed
    - conflict
    - waiting_for_input
```

### Files to Create/Modify

1. `.claude/skills/gitterflow/SKILL.md` - Add brain orchestration section
2. `.claude/hooks/stop.sh` - Stop hook for completion notification
3. `src/utils/agent-state.ts` - Add "waiting_for_input" status
4. `src/config.ts` - Add orchestration config
5. New: `src/utils/brain-wake.ts` - Wake file/FIFO logic
6. New: `src/commands/watch.ts` - Optional `gf watch` command for brain

---

## Issue 4: Persistent Memory via Claude Memory Tool

**Status:** Open
**Priority:** High
**Location:** New feature
**Reference:** https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

### Problem

Brain and subagents have no shared persistent memory across sessions. Each agent starts fresh without context about:
- What the brain learned about the project
- Decisions made by other agents
- Patterns and preferences discovered
- Progress on long-running tasks

### Claude Memory Tool Overview

The memory tool (beta) enables Claude to store/retrieve information across conversations:

```json
{
  "type": "memory_20250818",
  "name": "memory"
}
```

**Key Features:**
- Client-side implementation (you control storage)
- CRUD operations on a `/memories` directory
- Automatic context checking on startup
- Works with context editing for long-running workflows

**Commands:**
- `view` - Read directory or file contents
- `create` - Create new memory file
- `str_replace` - Update text in memory file
- `insert` - Insert text at specific line
- `delete` - Remove memory file
- `rename` - Rename/move memory file

### Proposed Architecture for GitterFlow

#### Shared Memory Directory

```
.gitterflow/
├── agents/           # Existing agent state (YAML)
├── memories/         # NEW: Shared memory files
│   ├── project/
│   │   ├── architecture.md    # Project structure understanding
│   │   ├── patterns.md        # Code patterns discovered
│   │   └── decisions.md       # Key decisions made
│   ├── brain/
│   │   ├── task-breakdown.md  # Current task decomposition
│   │   ├── progress.md        # Overall progress tracking
│   │   └── learnings.md       # What brain learned
│   └── agents/
│       ├── worktree-xyz/
│       │   ├── approach.md    # How agent solved the task
│       │   └── issues.md      # Problems encountered
│       └── worktree-abc/
│           └── ...
```

#### Integration Options

**Option A: Via Claude Code MCP Server**
- Create a custom MCP server that implements memory operations
- Points to `.gitterflow/memories/`
- Both brain and subagents connect to same server

**Option B: Via File Symlinks**
- Symlink `.gitterflow/memories/` to worktrees
- Each agent uses native file tools to read/write
- Simpler but requires coordination

**Option C: Direct API Integration** (if not using Claude Code)
- If building custom orchestrator with Anthropic SDK
- Pass memory tool in API requests
- Implement handlers for memory operations

### Brain-Subagent Memory Flow

```
┌────────────────────────────────────────────────────────────────┐
│  BRAIN                                                         │
│  1. Reads /memories/project/* to understand codebase          │
│  2. Breaks down task, writes /memories/brain/task-breakdown   │
│  3. Spawns subagents with task context                        │
│  4. On wake: reads /memories/agents/* to see what was learned │
│  5. Updates /memories/brain/progress with new state           │
└────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│  SUBAGENT 1      │ │  SUBAGENT 2      │ │  SUBAGENT 3      │
│                  │ │                  │ │                  │
│ Reads:           │ │ Reads:           │ │ Reads:           │
│ - project/*      │ │ - project/*      │ │ - project/*      │
│ - brain/task-*   │ │ - brain/task-*   │ │ - brain/task-*   │
│                  │ │                  │ │                  │
│ Writes:          │ │ Writes:          │ │ Writes:          │
│ - agents/self/*  │ │ - agents/self/*  │ │ - agents/self/*  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

### Memory Content Examples

**`/memories/project/patterns.md`:**
```markdown
# Project Code Patterns

## Testing
- Uses bun:test with describe/test blocks
- Mocks shell commands via exec parameter
- Coverage threshold: 80%

## Error Handling
- Throws Error with descriptive messages
- Uses stderr for user-facing errors
- Exit codes: 0=success, 1=failure

## Naming Conventions
- Commands: verbCommand (newCommand, finishCommand)
- Utils: camelCase functions
- Types: PascalCase interfaces
```

**`/memories/brain/task-breakdown.md`:**
```markdown
# Current Task: Implement Issue 2 (Permissions)

## Breakdown
1. [DONE] Analyze current permission handling
2. [IN PROGRESS] Add .claude to default symlinks - assigned to worktree-abc
3. [PENDING] Update documentation
4. [PENDING] Add tests

## Context
- Settings file: .claude/settings.json
- Symlink logic: src/utils/symlink.ts
- Config: src/config.ts
```

**`/memories/agents/worktree-abc/approach.md`:**
```markdown
# Task: Add .claude to default symlinks

## Approach Taken
1. Modified config.ts to include '.claude' in default symlink_files
2. Updated symlink.ts to handle directory symlinks
3. Added test case in symlink.test.ts

## Issues Encountered
- Symlink function only handled files, needed to add directory support
- Used lstat to check if source is directory

## Files Changed
- src/config.ts (line 34)
- src/utils/symlink.ts (lines 15-28)
- tests/unit/utils/symlink.test.ts (new tests)
```

### Claude Code Integration Considerations

Claude Code CLI may not directly support the memory tool API. Options:

1. **MCP Server approach** - Create `memory-mcp-server` that wraps file operations
2. **Skill-based approach** - Create a memory skill that reads/writes to `.gitterflow/memories/`
3. **Hook-based approach** - Use start/stop hooks to sync memory state

### Implementation Plan

**Phase 1: File-based memory (no API)**
- Create `.gitterflow/memories/` structure
- Add memory instructions to SKILL.md
- Brain/subagents use Read/Write tools on memory files
- Simple but effective

**Phase 2: MCP Server**
- Create MCP server implementing memory tool interface
- Configure in `.claude/settings.json` for auto-connection
- Better structure and validation

**Phase 3: Full API Integration** (for custom orchestrators)
- Use Anthropic SDK with memory tool
- Implement proper handlers
- Enable context editing for long sessions

### Files to Create/Modify

1. `.gitterflow/memories/` - Directory structure
2. `.claude/skills/gitterflow/SKILL.md` - Memory usage instructions
3. New: `src/mcp/memory-server.ts` - MCP server for memory (Phase 2)
4. New: `packages/memory-mcp/` - Separate package for MCP server

---

## Summary

| Issue | Priority | Effort | Impact |
|-------|----------|--------|--------|
| 1. Merge commit messages | Medium | Low | Better git history |
| 2. Subagent permissions | High | Low | Autonomous workflows |
| 3. Brain orchestration loop | High | Medium-High | Full automation |
| 4. Persistent memory | High | Medium | Cross-session learning |
| 5. Brain-controlled merges | **Critical** | Medium | Prevent corrupted base |
| 6. Plan-then-execute | High | Medium | Validate before work |
| 7. Evaluate Agent SDK | **High** | Medium | Architecture decision |

**Recommended order:**
1. **Issue 7 (Agent SDK eval)** - Decide foundation before building more
2. Issue 2 (permissions) - Quick win, unblocks subagents
3. Issue 5 (safe merges) - Critical safety, prevents data loss
4. Issue 6 (plan approval) - Prevents wasted work
5. Issue 1 (commit msgs) - Polish
6. Issue 4 Phase 1 (memory) - Enable cross-session learning
7. Issue 3 (orchestration) - Full automation
8. Issue 4 Phase 2+ (advanced memory) - Long-term improvement

**Note:** Issue 7 should be evaluated first - if the Agent SDK is adopted, it may simplify or replace Issues 3, 5, and 6.

---

## Issue 5: Safe Merge Strategy (Brain-Controlled Merges)

**Status:** Open
**Priority:** Critical
**Location:** `src/commands/finish.ts`, `SKILL.md`

### Problem

Current flow is dangerous:
1. Subagent runs `gf finish`
2. Subagent attempts merge into base branch
3. On conflict, subagent tries to resolve manually in base repo
4. Subagent lacks context about other agents' work
5. Risk of incorrect conflict resolution or corrupted base branch

### Current Flow (Dangerous)

```
Subagent A          Subagent B          Base Branch
    │                   │                   │
    ├── work ──────────►│                   │
    │                   ├── work ───────────►
    │                   │                   │
    ├── gf finish ─────►│                   │
    │   (merge A) ──────┼──────────────────►│
    │                   │                   │
    │                   ├── gf finish ─────►│
    │                   │   CONFLICT! ──────┤
    │                   │   Subagent B      │
    │                   │   resolves?? ─────┤  ← DANGEROUS
    │                   │                   │
```

### Proposed Solution: Brain-Controlled Merges

**Core principle**: Subagents only commit, never merge. Brain handles all merges.

```
Subagent A          Subagent B          Brain              Base Branch
    │                   │                 │                    │
    ├── work ──────────►│                 │                    │
    │                   ├── work ────────►│                    │
    │                   │                 │                    │
    ├── gf ready ──────►│                 │                    │
    │   (commit only)   │                 │                    │
    │                   ├── gf ready ────►│                    │
    │                   │   (commit only) │                    │
    │                   │                 │                    │
    │                   │                 ├── gf status ──────►│
    │                   │                 │   (see ready)      │
    │                   │                 │                    │
    │                   │                 ├── merge A ─────────►
    │                   │                 │   (success)        │
    │                   │                 │                    │
    │                   │                 ├── merge B ─────────►
    │                   │                 │   CONFLICT         │
    │                   │                 │                    │
    │                   │                 ├── resolve ─────────►
    │                   │                 │   (brain has       │
    │                   │                 │    full context)   │
```

### Implementation Options

#### Option A: Split finish into ready + merge

**New command `gf ready`** (subagent uses this):
```typescript
// Commits changes, updates status to "ready", but NO merge
await run`git add -A`;
await run`git commit -m ${message}`;
await updateAgentStatus(branch, "ready");
// Subagent exits, does NOT touch base branch
```

**Modified `gf finish`** (brain uses this):
```typescript
// Only brain should run this - merges a ready branch
// Or add --merge flag: gf finish --merge worktree-xyz
```

#### Option B: Add --no-merge flag

```bash
# Subagent runs:
gf finish --no-merge   # Commits and marks ready, no merge

# Brain runs:
gf merge worktree-xyz  # New command for brain to merge
```

#### Option C: Autonomous mode change

When `--autonomous` is used:
- Subagent runs `gf finish` but it only commits + sets status to "ready"
- Auto-merge is disabled for autonomous agents
- Brain is responsible for running merges

### Merge Queue Architecture

Brain maintains a merge queue to prevent race conditions:

```yaml
# .gitterflow/merge-queue.yaml
queue:
  - branch: worktree-abc
    status: ready
    priority: 1
  - branch: worktree-xyz
    status: ready
    priority: 2
current_merge: null
```

Brain processes queue:
1. Check for ready agents via `gf status`
2. Pick highest priority (or FIFO)
3. Attempt merge
4. On conflict: Brain resolves (has full context)
5. On success: Clean up, next in queue

### Conflict Resolution by Brain

When brain encounters conflict:

```markdown
## Brain Conflict Resolution Protocol

1. **Analyze both sides**: Read the conflicting changes from both branches
2. **Check agent memories**: Read .gitterflow/memories/agents/{branch}/ for context
3. **Understand intent**: What was each agent trying to accomplish?
4. **Resolve intelligently**: Make resolution based on full project understanding
5. **Verify**: Run tests after resolution
6. **Document**: Write resolution reasoning to memory
```

### Alternative: Rebase Before Ready

Subagents could rebase on latest base before marking ready:

```bash
# In gf ready:
git fetch origin ${baseBranch}
git rebase origin/${baseBranch}
# If rebase conflicts, subagent must resolve in its own worktree
# This is safer - conflicts are in isolation, not base branch
```

### Skill Update for Subagents

```markdown
## For Sub-Agents: Completing Your Task

When your task is complete:

1. Run `gf ready` (NOT `gf finish`)
2. This commits your changes and marks you as ready for merge
3. The brain agent will handle the actual merge
4. Do NOT attempt to merge or resolve conflicts yourself

If you encounter issues, write them to your agent state:
\`\`\`bash
gf status --write "Blocked: need clarification on X"
\`\`\`
```

### Files to Modify

1. `src/commands/finish.ts` - Add --no-merge or split logic
2. New: `src/commands/ready.ts` - New command for subagents
3. New: `src/commands/merge.ts` - Brain-only merge command
4. `.claude/skills/gitterflow/SKILL.md` - Update subagent instructions
5. `src/utils/agent-state.ts` - Add "ready" status

### References

- [Agent-MCP](https://github.com/rinadelph/Agent-MCP) - File-level locking for conflict prevention
- [Git Worktrees for AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) - Isolation strategies
- [Graphite AI Merge Resolution](https://graphite.com/guides/ai-code-merge-conflict-resolution) - AI-powered conflict resolution

---

## Issue 6: Subagent Plan-Then-Execute with Brain Approval

**Status:** Open
**Priority:** High
**Location:** `src/commands/new.ts`, `SKILL.md`

### Problem

Subagents currently dive straight into implementation without brain approval:
1. Brain spawns subagent with task
2. Subagent immediately starts coding
3. If approach is wrong, work is wasted
4. No checkpoint for brain to validate direction

### Desired Flow

```
Brain                 Subagent              Shared State
  │                      │                      │
  ├── spawn ────────────►│                      │
  │   (plan mode)        │                      │
  │                      ├── analyze ──────────►│
  │                      │   codebase           │
  │                      │                      │
  │                      ├── write plan ───────►│
  │                      │   to memory          │
  │                      │                      │
  │                      ├── status: ──────────►│
  │                      │   "awaiting_approval"│
  │                      │                      │
  │◄─────────────────────┤   (notify brain)     │
  │                      │                      │
  ├── read plan ◄───────────────────────────────┤
  │                      │                      │
  ├── approve/reject ───►│                      │
  │                      │                      │
  │                      ├── execute ──────────►│
  │                      │   (if approved)      │
```

### Claude Code Plan Mode

Claude Code supports starting in plan mode:

```bash
claude --permission-mode plan
```

In plan mode:
- Read-only operations only (Read, Grep, Glob, WebSearch)
- Cannot create, modify, or delete files
- Must use `ExitPlanMode` tool to transition to execution
- User approval required to exit plan mode

### Proposed Architecture

#### Phase 1: Plan File Handoff

1. **Spawn in plan mode**:
```bash
gf new --task "..." --autonomous --plan-first
```

2. **Subagent writes plan to shared location**:
```
.gitterflow/memories/agents/worktree-xyz/plan.md
```

3. **Subagent sets status**:
```yaml
status: awaiting_approval
plan_file: .gitterflow/memories/agents/worktree-xyz/plan.md
```

4. **Brain polls, reads plan, decides**:
```bash
# Brain approves by writing to agent state or touching approval file
gf approve worktree-xyz
# Or
gf reject worktree-xyz --reason "Need different approach"
```

5. **Subagent resumes on approval**

#### Phase 2: Automated Approval Loop

The challenge: Claude Code sessions are interactive, can't "wait" for external input.

**Solution A: Two-phase spawning**

```bash
# Phase 1: Plan only
gf new --task "..." --plan-only
# Subagent exits after writing plan

# Brain reviews, then:
gf execute worktree-xyz  # Spawns new agent to implement plan
```

**Solution B: Approval file watching**

Subagent in plan mode could poll for approval:
```markdown
## Subagent Plan Mode Instructions

1. Analyze the codebase and write your plan to:
   `.gitterflow/memories/agents/{your-branch}/plan.md`

2. Set your status:
   `gf status --write "awaiting_approval"`

3. Wait for approval file:
   Poll for `.gitterflow/agents/{your-branch}.approved`
   Or check `gf status` for approval flag

4. On approval: Exit plan mode and implement
5. On rejection: Read feedback, revise plan, repeat
```

**Solution C: Hook-based continuation**

```json
// .claude/settings.local.json in worktree
{
  "hooks": {
    "Stop": [{
      "type": "command",
      "command": "check-approval-and-restart.sh"
    }]
  }
}
```

Agent exits after planning → hook checks for approval → restarts with execute permission.

### Implementation Details

#### New gf new flag

```bash
gf new --task "..." --autonomous --plan-first

# Sets up:
# 1. --permission-mode plan in Claude launch
# 2. Adds system prompt: "Write plan, wait for approval"
# 3. Creates approval workflow files
```

#### Modified buildAgentCommand

```typescript
function buildAgentCommand(
  baseCommand: string,
  task?: string,
  options?: { autonomous?: boolean; planFirst?: boolean }
): string {
  const flags = ["--permission-mode"];

  if (options?.planFirst) {
    flags.push("plan");  // Start in plan mode
    // Add system prompt about writing plan and waiting
  } else {
    flags.push("acceptEdits");
  }

  // ... rest of command building
}
```

#### Approval command

```bash
# New command: gf approve
gf approve worktree-xyz
# Writes approval to agent state
# Subagent can poll for this

# Or with feedback:
gf approve worktree-xyz --message "Looks good, proceed"
gf reject worktree-xyz --message "Use strategy X instead"
```

### Plan File Format

```markdown
# Implementation Plan: {task summary}

## Analysis
- Examined files: [list]
- Key findings: [summary]

## Proposed Approach
1. Step one
2. Step two
3. ...

## Files to Modify
- `src/foo.ts` - Add new function
- `src/bar.ts` - Update imports

## Files to Create
- `src/new-feature.ts` - Main implementation
- `tests/new-feature.test.ts` - Tests

## Risks and Considerations
- Risk 1: mitigation
- Risk 2: mitigation

## Questions for Brain (if any)
- Should we use approach A or B for X?
```

### Brain Orchestration Update

```markdown
## For Brain Agents: Plan Review Protocol

When subagents are in `awaiting_approval` status:

1. Read their plan from `.gitterflow/memories/agents/{branch}/plan.md`
2. Evaluate:
   - Does the approach align with overall architecture?
   - Are there conflicts with other agents' plans?
   - Is the scope appropriate?
3. Decide:
   - `gf approve {branch}` - Plan is good, proceed
   - `gf reject {branch} --message "..."` - Needs revision
4. Monitor for completion
```

### Files to Create/Modify

1. `src/commands/new.ts` - Add --plan-first flag
2. New: `src/commands/approve.ts` - Approval command
3. New: `src/commands/reject.ts` - Rejection command
4. `src/utils/agent-state.ts` - Add "awaiting_approval" status
5. `.claude/skills/gitterflow/SKILL.md` - Plan mode instructions

### References

- [Claude Code Plan Mode](https://medium.com/@kuntal-c/claude-code-plan-mode-revolutionizing-the-senior-engineers-workflow-21d054ee3420)
- [Architecture of Intent](https://lord.technology/2025/07/03/understanding-claude-code-plan-mode-and-the-architecture-of-intent.html)
- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)

---

## Issue 7: Evaluate Claude Agent SDK as Foundation

**Status:** Open
**Priority:** High (Architectural Decision)
**Location:** Entire codebase
**Reference:** https://platform.claude.com/docs/en/agent-sdk/overview

### Problem

GitterFlow's complexity is growing with Issues 3-6. Current architecture relies on:
- CLI process spawning (`claude` command)
- File-based inter-agent communication
- Polling for status changes
- Hooks and workarounds for coordination

The Claude Agent SDK may provide a more robust foundation with native support for:
- Programmatic agent spawning
- Built-in subagent orchestration
- Session management and resumption
- Hooks as callbacks (not shell commands)
- Direct tool execution control

### Questions to Answer

1. **Feasibility**: Can GitterFlow be rebuilt on the Agent SDK?
2. **Benefits**: What problems does the SDK solve natively vs. our workarounds?
3. **Migration path**: Incremental adoption or full rewrite?
4. **Trade-offs**: What do we lose? (CLI simplicity, user familiarity)
5. **Hybrid approach**: Can we use SDK for brain, CLI for subagents?

### Key SDK Features to Evaluate

| Feature | SDK Capability | Current GitterFlow Approach |
|---------|---------------|----------------------------|
| Subagents | Native `agents` option with Task tool | CLI spawning + file-based state |
| Hooks | Callback functions | Shell commands in settings.json |
| Sessions | `resume` option with session_id | None (each agent is fresh) |
| Permissions | `allowed_tools`, `permission_mode` | CLI flags + settings.json |
| MCP | `mcp_servers` option | Manual configuration |
| Tool execution | Built-in Read, Edit, Bash, etc. | Via Claude Code CLI |

### SDK Architecture Overview

```python
# Brain agent with subagent orchestration
async for message in query(
    prompt="Implement features A, B, C in parallel",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Glob", "Grep", "Task"],
        agents={
            "implementer": AgentDefinition(
                description="Implements features in isolation",
                prompt="Implement the assigned feature. Write plan first.",
                tools=["Read", "Edit", "Write", "Bash"]
            )
        },
        hooks={
            "PostToolUse": [HookMatcher(
                matcher="Task",
                hooks=[on_subagent_complete]  # Direct callback!
            )]
        }
    )
):
    handle_message(message)
```

### Potential Architecture with SDK

```
┌────────────────────────────────────────────────────────────┐
│  GitterFlow Orchestrator (Python/TypeScript)              │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Brain Agent (via Agent SDK)                         │ │
│  │  - Has Task tool for spawning subagents              │ │
│  │  - Hooks for subagent completion callbacks           │ │
│  │  - Session persistence for context                   │ │
│  └──────────────────────────────────────────────────────┘ │
│                         │                                  │
│         ┌───────────────┼───────────────┐                 │
│         ▼               ▼               ▼                 │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│  │ Subagent 1 │  │ Subagent 2 │  │ Subagent 3 │          │
│  │ (SDK Task) │  │ (SDK Task) │  │ (SDK Task) │          │
│  │            │  │            │  │            │          │
│  │ Worktree A │  │ Worktree B │  │ Worktree C │          │
│  └────────────┘  └────────────┘  └────────────┘          │
│                                                            │
│  Git worktrees still provide isolation                    │
│  SDK provides orchestration                               │
└────────────────────────────────────────────────────────────┘
```

### Research Tasks

1. **Prototype brain agent** - Simple SDK-based orchestrator
2. **Test subagent spawning** - Can SDK subagents work in different directories?
3. **Evaluate worktree integration** - SDK + git worktrees compatibility
4. **Compare complexity** - Lines of code, maintainability
5. **Performance testing** - SDK overhead vs CLI spawning
6. **Session/memory integration** - How SDK sessions compare to our memory approach

### Decision Criteria

**Migrate to SDK if:**
- Native subagent handling solves Issues 3, 5, 6 more elegantly
- Hooks as callbacks simplify brain-subagent communication
- Session management provides better context than file-based memory
- Reduced complexity in orchestration code

**Keep CLI approach if:**
- SDK adds too much abstraction for simple use cases
- Worktree isolation doesn't work well with SDK
- Users prefer CLI-based workflow
- SDK is too new/unstable for production

### Deliverables

1. Proof-of-concept brain agent using Agent SDK
2. Comparison document: SDK vs current architecture
3. Migration plan (if SDK is chosen)
4. Updated architecture diagram

### Files to Create

1. `research/agent-sdk-poc/` - Prototype code
2. `docs/AGENT-SDK-EVALUATION.md` - Findings and recommendation
3. `docs/ARCHITECTURE-V2.md` - Proposed SDK-based architecture (if applicable)
