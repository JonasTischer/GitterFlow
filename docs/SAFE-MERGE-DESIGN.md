# Safe Merge Strategy: Brain-Controlled Merges

**Status:** Design Complete
**Priority:** Critical
**Related Issue:** Issue 5 in docs/ISSUES.md

## Executive Summary

This document describes the design for a safe merge strategy that prevents subagents from directly merging into the base branch. Instead, subagents only commit their work and signal readiness, while the brain (orchestrating agent) handles all merges with full context.

---

## Problem Statement

### Current Dangerous Flow

The current implementation allows subagents to run `gf finish`, which directly merges into the base branch:

```
Subagent A          Subagent B          Base Branch (main)
    │                   │                      │
    ├── work ──────────►│                      │
    │                   ├── work ─────────────►│
    │                   │                      │
    ├── gf finish ─────►│                      │
    │   ┌──────────────────────────────────────┤
    │   │ MERGE A into main                    │
    │   └──────────────────────────────────────►
    │                   │                      │
    │                   ├── gf finish ────────►│
    │                   │   ┌──────────────────┤
    │                   │   │ CONFLICT!        │
    │                   │   │ Subagent B       │
    │                   │   │ tries to resolve │◄── DANGEROUS!
    │                   │   │ without context  │
    │                   │   └──────────────────┤
    │                   │                      │
```

### Why This Is Dangerous

1. **No Coordination**: Subagent B doesn't know what Subagent A merged
2. **Incomplete Context**: Subagent B only sees its own work, not the full picture
3. **Race Conditions**: Multiple agents can attempt merges simultaneously
4. **Wrong Resolver**: The agent with least context is resolving conflicts
5. **Base Branch Corruption**: Bad conflict resolution corrupts the base branch for everyone

### Real-World Scenario

```
Brain spawns:
├── Subagent A: "Refactor the API client to use async/await"
├── Subagent B: "Add retry logic to API calls"
└── Subagent C: "Add comprehensive error handling to API"

All three touch similar files. Without coordination:
- A finishes first, merges successfully
- B finishes, has conflicts with A's changes
- B "resolves" conflicts incorrectly (doesn't understand A's refactor)
- C finishes, has massive conflicts with broken merge from B
- Base branch now has corrupted API code
```

---

## Proposed Solution: Brain-Controlled Merges

### Core Principle

**Subagents only commit, never merge. The brain handles all merges.**

### New Safe Flow

```
Subagent A          Subagent B          Brain              Base Branch
    │                   │                 │                    │
    ├── work ──────────►│                 │                    │
    │                   ├── work ────────►│                    │
    │                   │                 │                    │
    ├── gf ready ──────►│                 │                    │
    │   [commit only]   │                 │                    │
    │   [status: ready] │                 │                    │
    │                   │                 │                    │
    │                   ├── gf ready ────►│                    │
    │                   │   [commit only] │                    │
    │                   │   [status: ready]                    │
    │                   │                 │                    │
    │                   │                 ├── gf status ──────►│
    │                   │                 │   [sees: A ready,  │
    │                   │                 │    B ready]        │
    │                   │                 │                    │
    │                   │                 ├── merge A ─────────►
    │                   │                 │   [success]        │
    │                   │                 │                    │
    │                   │                 ├── merge B ─────────►
    │                   │                 │   [CONFLICT]       │
    │                   │                 │                    │
    │                   │                 ├── RESOLVE ─────────►
    │                   │                 │   [brain has full  │
    │                   │                 │    context of both │
    │                   │                 │    A and B work]   │
    │                   │                 │                    │
```

---

## Implementation Design

### 1. New Agent Status: `ready`

Add a new status to the AgentStatus type:

```typescript
// src/utils/agent-state.ts
export type AgentStatus =
  | "pending"     // Agent spawned but not yet started
  | "running"     // Agent is actively working
  | "ready"       // NEW: Agent committed work, awaiting brain merge
  | "completed"   // Work done (deprecated for autonomous, use merged)
  | "failed"      // Agent encountered an error
  | "conflict"    // Merge conflict detected
  | "merged";     // Successfully merged by brain
```

**Status Transitions:**
```
pending → running → ready → merged
                      ↓
                   conflict → [brain resolves] → merged
                      ↓
                    failed
```

### 2. New Command: `gf ready`

A lightweight command that subagents use instead of `gf finish`:

```typescript
// src/commands/ready.ts
export const readyCommand: CommandDefinition = {
  name: "ready",
  description: "Mark work as ready for brain to merge (subagent use only)",
  usage: "gf ready",
  run: async ({ stdout, stderr, exec }) => {
    // 1. Commit any uncommitted changes (same as snap)
    await commitUncommittedChanges(exec, stdout);

    // 2. Update agent status to "ready"
    const branch = await getCurrentBranch(exec);
    await updateAgentStatus(branch, "ready");

    // 3. Output success message
    stdout(`✅ Work committed and marked as ready for merge`);
    stdout(`   The brain agent will handle merging into base branch.`);

    // 4. Exit successfully - DO NOT merge, DO NOT delete worktree
    return 0;
  }
};
```

**Key Differences from `gf finish`:**

| Behavior | `gf finish` | `gf ready` |
|----------|-------------|------------|
| Commits changes | ✅ Yes | ✅ Yes |
| Merges to base | ✅ Yes | ❌ No |
| Deletes worktree | ✅ Yes | ❌ No |
| Handles conflicts | ✅ Tries to | ❌ Never |
| Safe for subagents | ❌ No | ✅ Yes |

### 3. Modified `gf finish` for Brain Use

`gf finish` remains available but with new brain-focused options:

```typescript
// Enhanced gf finish for brain usage
gf finish                    // Current behavior (for manual use)
gf finish --merge <branch>   // Brain merges a specific ready branch
gf finish --merge-all        // Brain merges all ready branches in order
```

**Brain Merge Flow:**
```typescript
// When brain runs: gf finish --merge worktree-abc
async function mergeBranch(branch: string) {
  // 1. Verify branch is in "ready" status
  const state = await readAgentState(branch);
  if (state.status !== "ready") {
    throw new Error(`Branch ${branch} is not ready (status: ${state.status})`);
  }

  // 2. Checkout base branch
  await exec`git checkout ${state.base_branch}`;

  // 3. Pull latest
  await exec`git pull origin ${state.base_branch}`;

  // 4. Attempt merge
  try {
    await exec`git merge ${branch} --no-edit`;
  } catch (error) {
    if (isConflictError(error)) {
      // Update status so brain knows to resolve
      await updateAgentStatus(branch, "conflict");
      throw new ConflictError(branch, state.base_branch);
    }
    throw error;
  }

  // 5. Update status to merged
  await updateAgentStatus(branch, "merged");

  // 6. Cleanup worktree and branch
  await cleanupWorktree(branch);
}
```

### 4. Brain Conflict Resolution Protocol

When brain encounters a conflict, it follows this protocol:

```markdown
## Brain Conflict Resolution Protocol

When `gf finish --merge <branch>` returns a conflict:

1. **Stop and Analyze**
   - Read the conflict markers in affected files
   - Review both sides of the conflict

2. **Gather Context**
   - Read the agent's task from `.gitterflow/agents/<branch>.yaml`
   - Review the agent's commits: `git log main..<branch>`
   - Check if agent wrote notes in `.gitterflow/memories/` (if using memory system)

3. **Review Other Merges**
   - What was already merged that caused this conflict?
   - Is there a logical order these should have been merged?

4. **Resolve Intelligently**
   - Combine changes when both are needed
   - Choose one side when they're alternatives
   - Refactor if the merge reveals a better structure

5. **Verify**
   - Run tests after resolution
   - Check that both agents' intents are preserved

6. **Document** (optional but recommended)
   - Note the resolution in commit message
   - If pattern emerges, consider preventing such conflicts in future task assignments
```

---

## SKILL.md Updates

### For Sub-Agents: New Instructions

```markdown
## For Sub-Agents: Completing Your Task

When your task is complete:

1. **Use `gf ready`** (NOT `gf finish`)
   ```bash
   gf ready
   ```
   This command:
   - Commits any uncommitted changes with an AI-generated message
   - Marks your work as ready for merge
   - Exits successfully

2. **Do NOT:**
   - Run `gf finish` (this would attempt to merge)
   - Manually merge into the base branch
   - Try to resolve merge conflicts yourself

3. **The brain agent will:**
   - See your "ready" status via `gf status`
   - Merge your changes at the right time
   - Handle any conflicts with full context

**Why this matters:** You can't see what other agents are doing. The brain
coordinates all merges to prevent conflicts and ensure changes integrate correctly.
```

### For Brain Agents: New Instructions

```markdown
## For Brain Agents: Merging Sub-Agent Work

When sub-agents complete their tasks:

1. **Monitor Progress**
   ```bash
   gf status
   ```
   Look for agents with `ready` status.

2. **Merge One at a Time**
   ```bash
   gf finish --merge <branch-name>
   ```

   Or merge all ready branches:
   ```bash
   gf finish --merge-all
   ```

3. **Handle Conflicts**
   If a merge conflicts:
   - The command will exit with conflict status
   - You are in the base branch with conflict markers
   - Resolve based on your understanding of ALL agents' work
   - Stage resolved files: `git add .`
   - Complete merge: `git commit`
   - Continue with next merge

4. **Merge Order Considerations**
   - Independent features: any order works
   - Overlapping changes: merge simpler/foundation first
   - If unsure, check the diffs before merging
```

---

## Command Changes Summary

| Command | Current Behavior | New Behavior |
|---------|------------------|--------------|
| `gf ready` | ❌ Doesn't exist | Commit + mark ready (no merge) |
| `gf finish` | Commit + merge + cleanup | Unchanged (for manual/brain use) |
| `gf finish --merge <branch>` | ❌ Doesn't exist | Brain merges specific ready branch |
| `gf finish --merge-all` | ❌ Doesn't exist | Brain merges all ready branches |
| `gf status` | Shows agent statuses | No change (already shows `ready`) |

---

## Migration Path

### Phase 1: Add Infrastructure (This Issue)
1. Add `ready` status to AgentStatus type
2. Create `gf ready` command stub
3. Update SKILL.md with new instructions
4. Document the design (this file)

### Phase 2: Full Implementation
1. Implement full `gf ready` command
2. Add `--merge` and `--merge-all` flags to `gf finish`
3. Update `gf new --autonomous` to use `gf ready` in stop hook
4. Add tests for new workflow

### Phase 3: Validation
1. Test with real multi-agent scenarios
2. Verify conflict resolution flow
3. Measure improvement in merge success rate

---

## Appendix: Alternative Approaches Considered

### Option A: Rebase Before Ready
Subagents rebase on latest base before marking ready:
```bash
git fetch origin main
git rebase origin/main
gf ready
```

**Pros:** Conflicts happen in isolation, easier to resolve
**Cons:** Subagent still lacks context about what's in main

**Decision:** Could be added as enhancement, but doesn't solve core problem

### Option B: --no-merge Flag
Add `gf finish --no-merge` for subagents:
```bash
gf finish --no-merge
```

**Pros:** Uses existing command
**Cons:** Easy to forget flag; finish semantically implies merge

**Decision:** Separate command (`gf ready`) is clearer and safer

### Option C: Autonomous Mode Change
When `--autonomous` is used, `gf finish` automatically behaves like `gf ready`:

**Pros:** No new commands needed
**Cons:** Confusing - same command does different things based on context

**Decision:** Explicit is better than implicit

---

## References

- [Agent-MCP](https://github.com/rinadelph/Agent-MCP) - File-level locking for conflict prevention
- [Git Worktrees for AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) - Isolation strategies
- [Graphite AI Merge Resolution](https://graphite.com/guides/ai-code-merge-conflict-resolution) - AI-powered conflict resolution
