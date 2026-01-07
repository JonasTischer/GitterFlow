# Plan-Then-Execute Workflow with Brain Approval

> Design document for Issue 6: Subagent Plan-Then-Execute with Brain Approval

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Claude Code Plan Mode Overview](#claude-code-plan-mode-overview)
3. [Proposed Architecture](#proposed-architecture)
4. [Implementation Design](#implementation-design)
5. [Workflow Examples](#workflow-examples)
6. [Files to Modify](#files-to-modify)
7. [Future Considerations](#future-considerations)

---

## Problem Statement

### Current Issue

Subagents dive straight into implementation without brain approval:

```
Brain                 Subagent
  │                      │
  ├── spawn ────────────►│
  │   "Implement X"      │
  │                      ├── immediately starts coding
  │                      │   (approach may be wrong)
  │                      │
  │                      ├── finishes work
  │                      │   (potentially wasted effort)
```

**Problems:**
1. If approach is wrong, work is wasted
2. No checkpoint for brain to validate direction
3. Subagent may make architectural decisions brain disagrees with
4. Multiple subagents could take conflicting approaches

### Desired Outcome

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
  │◄─────────────────────┤   (agent exits)      │
  │                      │                      │
  ├── read plan ◄───────────────────────────────┤
  │                      │                      │
  ├── approve ──────────►│ (new session)        │
  │                      │                      │
  │                      ├── execute ──────────►│
  │                      │   (implement plan)   │
```

---

## Claude Code Plan Mode Overview

### How Plan Mode Works

Claude Code supports starting in plan mode via:

```bash
claude --permission-mode plan
```

**In plan mode:**
- **Read-only tools available:** Read, Glob, Grep, WebSearch, WebFetch, Task (research)
- **Write tools restricted:** Edit, Bash (mutations), Write
- **Enforcement:** Prompt-based + tool filtering (not cryptographic)
- **Exit mechanism:** `ExitPlanMode` tool requires user approval

### Key Insight

Plan mode is enforced through a **system reminder** injected into each user message:

> "Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes to the system."

This combined with **tool availability filtering** prevents accidental mutations.

### ExitPlanMode Tool

The `ExitPlanMode` tool serves as the approval gateway:

1. Agent calls `ExitPlanMode` after writing plan
2. Tool prompts user for approval
3. On approval: Write tools become available
4. On rejection: Agent stays in plan mode

**Critical:** In our workflow, the "user" is the brain agent, not a human. This requires a different approval mechanism.

---

## Proposed Architecture

### Two-Phase Spawning Model

Since Claude Code sessions are interactive and can't "wait" for external approval, we use a **two-phase spawning model**:

```
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 1: PLANNING                                                 │
│                                                                    │
│  gf new --task "..." --plan-first --autonomous                     │
│  └── Spawns Claude with --permission-mode plan                     │
│  └── System prompt: "Write plan to file, then exit"                │
│  └── Agent analyzes, writes plan, sets status, exits               │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  BRAIN REVIEW                                                      │
│                                                                    │
│  Brain polls `gf status` for awaiting_approval                     │
│  Brain reads plan from .gitterflow/agents/{branch}/plan.md         │
│  Brain decides: approve or reject                                  │
│                                                                    │
│  gf approve {branch}     ← Creates approval marker                 │
│  gf reject {branch}      ← Creates rejection with feedback         │
└───────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│  PHASE 2: EXECUTION                                                │
│                                                                    │
│  gf approve triggers spawn of execution phase:                     │
│  └── Spawns Claude with --permission-mode acceptEdits              │
│  └── System prompt: "Execute approved plan at path X"              │
│  └── Agent implements plan, runs gf finish                         │
└───────────────────────────────────────────────────────────────────┘
```

### Agent Status Lifecycle

```
┌─────────┐     ┌───────────────────┐     ┌──────────┐
│ pending │────►│ awaiting_approval │────►│ running  │
└─────────┘     └───────────────────┘     └──────────┘
     │                   │                      │
     │                   │                      ▼
     │                   │              ┌────────────┐
     │                   │              │ completed  │
     │                   │              │   merged   │
     │                   │              │   failed   │
     │                   │              │  conflict  │
     │                   │              └────────────┘
     │                   │
     │                   ▼
     │           ┌────────────┐
     │           │  rejected  │ (can be re-planned)
     │           └────────────┘
     │
     └──────────────────────────────────────────────────►
        (direct execution without --plan-first)
```

### File Structure

```
.gitterflow/
├── agents/
│   ├── worktree-xyz.yaml          # Agent state (existing)
│   │   branch: worktree-xyz
│   │   status: awaiting_approval
│   │   task: "Implement feature X"
│   │   plan_file: .gitterflow/agents/worktree-xyz/plan.md
│   │   ...
│   │
│   └── worktree-xyz/              # Agent workspace (new)
│       ├── plan.md                # The plan document
│       ├── approval.yaml          # Approval/rejection status
│       └── brain-feedback.md      # Brain's feedback (if rejected)
```

---

## Implementation Design

### 1. New Agent Status: `awaiting_approval`

**File:** `src/utils/agent-state.ts`

```typescript
export type AgentStatus =
  | "pending"
  | "awaiting_approval"  // NEW: Plan written, waiting for brain
  | "running"
  | "completed"
  | "failed"
  | "conflict"
  | "merged";
```

### 2. Modified `gf new` Command

**File:** `src/commands/new.ts`

New flag: `--plan-first` (or `-p`)

```typescript
function parseArgs(args: string[]): {
  branch?: string;
  task?: string;
  force?: boolean;
  autonomous?: boolean;
  planFirst?: boolean;  // NEW
} {
  // ... existing code ...
  if (arg === "--plan-first" || arg === "-p") {
    planFirst = true;
  }
  // ...
}
```

Modified `buildAgentCommand`:

```typescript
function buildAgentCommand(
  baseCommand: string,
  task?: string,
  options?: { autonomous?: boolean; planFirst?: boolean }
): string {
  const isClaude = baseCommand === "claude" || baseCommand.startsWith("claude ");

  if (!isClaude) {
    // Non-claude agents don't support plan mode
    if (!task) return baseCommand;
    const escapedTask = task.replace(/"/g, '\\"');
    return `${baseCommand} "${escapedTask}"`;
  }

  // Build Claude command with appropriate flags
  const flags: string[] = [];

  if (options?.planFirst) {
    // Phase 1: Plan only
    flags.push("--permission-mode plan");

    // System prompt for plan-first mode
    const systemPrompt = `You are in PLAN mode. Your task:

1. Analyze the codebase to understand what needs to be done
2. Write a detailed implementation plan to: .gitterflow/agents/{branch}/plan.md
3. Run: gf status --write "awaiting_approval"
4. Exit (do not implement anything)

Plan format:
- ## Analysis: What you found in the codebase
- ## Approach: How you'll implement the task
- ## Files to Modify: List of files and changes
- ## Files to Create: New files needed
- ## Risks: Potential issues
- ## Questions: Anything needing clarification`;

    flags.push(`--append-system-prompt "${systemPrompt.replace(/"/g, '\\"')}"`);
  } else {
    flags.push("--permission-mode acceptEdits");

    if (options?.autonomous) {
      const systemPrompt = "When you complete this task, use the gitterflow skill to finish and merge your changes back to the base branch.";
      flags.push(`--append-system-prompt "${systemPrompt}"`);
    }
  }

  if (!task) {
    return `claude ${flags.join(" ")}`;
  }

  const escapedTask = task.replace(/"/g, '\\"');
  return `claude ${flags.join(" ")} "${escapedTask}"`;
}
```

### 3. New Command: `gf approve`

**File:** `src/commands/approve.ts`

```typescript
import type { CommandDefinition, CommandContext } from "./types";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import { spawnTerminal } from "../utils/terminal";
import { getSetting } from "../config";

export const approveCommand: CommandDefinition = {
  name: "approve",
  description: "Approve a subagent's plan and start execution phase",
  usage: "gitterflow approve <branch> [--message <feedback>]",

  run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
    const branch = args[0];

    if (!branch) {
      stderr("Usage: gf approve <branch>");
      return 1;
    }

    // Read agent state
    const state = await readAgentState(branch);
    if (!state) {
      stderr(`No agent found for branch: ${branch}`);
      return 1;
    }

    if (state.status !== "awaiting_approval") {
      stderr(`Agent is not awaiting approval (status: ${state.status})`);
      return 1;
    }

    // Write approval marker
    const approvalPath = `.gitterflow/agents/${branch}/approval.yaml`;
    await Bun.write(approvalPath, `approved: true\napproved_at: ${new Date().toISOString()}\n`);

    // Update status to running
    await updateAgentStatus(branch, "running");

    stdout(`✅ Approved plan for ${branch}`);
    stdout(`📍 Spawning execution phase...`);

    // Spawn execution phase
    const baseAgentCommand = getSetting("coding_agent");
    const planPath = `.gitterflow/agents/${branch}/plan.md`;

    const executionPrompt = `Execute the approved plan at: ${planPath}

Read the plan file and implement exactly what was planned.
When complete, run: gf finish`;

    const agentCommand = `claude --permission-mode acceptEdits --append-system-prompt "When you complete this task, use the gitterflow skill to finish." "${executionPrompt}"`;

    spawnTerminal(state.worktree_path, agentCommand);

    stdout(`🚀 Execution phase started for ${branch}`);
    return 0;
  },
};
```

### 4. New Command: `gf reject`

**File:** `src/commands/reject.ts`

```typescript
import type { CommandDefinition, CommandContext } from "./types";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";

export const rejectCommand: CommandDefinition = {
  name: "reject",
  description: "Reject a subagent's plan with feedback",
  usage: "gitterflow reject <branch> --message <feedback>",

  run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
    const branch = args[0];
    let message = "";

    // Parse --message flag
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--message" || args[i] === "-m") {
        message = args[i + 1] || "";
        break;
      }
    }

    if (!branch) {
      stderr("Usage: gf reject <branch> --message <feedback>");
      return 1;
    }

    // Read agent state
    const state = await readAgentState(branch);
    if (!state) {
      stderr(`No agent found for branch: ${branch}`);
      return 1;
    }

    if (state.status !== "awaiting_approval") {
      stderr(`Agent is not awaiting approval (status: ${state.status})`);
      return 1;
    }

    // Write rejection with feedback
    const feedbackPath = `.gitterflow/agents/${branch}/brain-feedback.md`;
    await Bun.write(feedbackPath, `# Brain Feedback\n\nRejected at: ${new Date().toISOString()}\n\n## Feedback\n\n${message}\n`);

    const approvalPath = `.gitterflow/agents/${branch}/approval.yaml`;
    await Bun.write(approvalPath, `approved: false\nrejected_at: ${new Date().toISOString()}\nreason: "${message}"\n`);

    // Update status to rejected (or keep as pending for re-planning)
    // For now, we'll mark as failed with the rejection reason
    await updateAgentStatus(branch, "failed", { error: `Plan rejected: ${message}` });

    stdout(`❌ Rejected plan for ${branch}`);
    if (message) {
      stdout(`📝 Feedback: ${message}`);
    }
    stdout(`💡 To re-plan: gf new --task "..." --plan-first (in the worktree)`);
    return 0;
  },
};
```

### 5. Plan File Format

**Location:** `.gitterflow/agents/{branch}/plan.md`

```markdown
# Implementation Plan: {task summary}

## Analysis

**Examined files:**
- `src/commands/new.ts` - Current command implementation
- `src/utils/agent-state.ts` - Status management

**Key findings:**
- Current implementation uses `--permission-mode acceptEdits`
- No plan-first workflow exists
- Agent state already has most needed infrastructure

## Approach

1. Add `awaiting_approval` status to AgentStatus type
2. Add `--plan-first` flag to parseArgs()
3. Modify buildAgentCommand() for plan mode
4. Create plan file during plan phase
5. Exit after setting status

## Files to Modify

| File | Changes |
|------|---------|
| `src/utils/agent-state.ts` | Add `awaiting_approval` to AgentStatus |
| `src/commands/new.ts` | Add `--plan-first` flag, modify buildAgentCommand |

## Files to Create

| File | Purpose |
|------|---------|
| `src/commands/approve.ts` | Approval command |
| `src/commands/reject.ts` | Rejection command |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Plan mode may not fully restrict tools | Use system prompt reinforcement |
| Agent might not write plan correctly | Provide detailed format instructions |

## Questions for Brain

- Should rejected plans allow re-planning in same worktree?
- Should we add a timeout for awaiting_approval status?
```

---

## Workflow Examples

### Example 1: Successful Plan-Execute Cycle

```bash
# Brain spawns subagent in plan mode
brain$ gf new --task "Add retry logic to API client" --plan-first --autonomous

# Subagent analyzes, writes plan, exits
# Status: awaiting_approval

# Brain checks status
brain$ gf status
AUTONOMOUS AGENTS
────────────────────────────────────────────────────────────────
Branch              Status              Task                 Started
────────────────────────────────────────────────────────────────
worktree-abc-123    awaiting_approval   Add retry logic...   1 min ago

# Brain reads the plan
brain$ cat .gitterflow/agents/worktree-abc-123/plan.md

# Brain approves
brain$ gf approve worktree-abc-123
✅ Approved plan for worktree-abc-123
📍 Spawning execution phase...
🚀 Execution phase started

# Subagent implements plan, runs gf finish
# Status: merged
```

### Example 2: Plan Rejection with Feedback

```bash
# Brain reads plan and disagrees with approach
brain$ gf reject worktree-abc-123 --message "Use exponential backoff instead of linear"
❌ Rejected plan for worktree-abc-123
📝 Feedback: Use exponential backoff instead of linear

# Worktree still exists, can re-plan manually or spawn new agent
```

### Example 3: Parallel Planning

```bash
# Brain spawns multiple plan-first agents
brain$ gf new --task "Feature A" --plan-first --autonomous
brain$ gf new --task "Feature B" --plan-first --autonomous
brain$ gf new --task "Feature C" --plan-first --autonomous

# All three analyze in parallel (read-only, no conflicts)
# Brain reviews all plans before any execution begins
brain$ gf status
# Shows 3 agents in awaiting_approval

# Brain approves compatible plans, rejects conflicting ones
brain$ gf approve worktree-feature-a
brain$ gf approve worktree-feature-b
brain$ gf reject worktree-feature-c --message "Conflicts with approach in Feature A"
```

---

## Files to Modify

### Phase 1: Minimal Implementation (Stubs)

| File | Change |
|------|--------|
| `src/utils/agent-state.ts` | Add `awaiting_approval` to `AgentStatus` |
| `src/commands/new.ts` | Add `--plan-first` flag parsing (stub) |
| `src/commands/approve.ts` | Create placeholder command |
| `src/commands/reject.ts` | Create placeholder command |
| `src/commands/index.ts` | Register new commands |
| `SKILL.md` | Add plan mode instructions |

### Phase 2: Full Implementation

| File | Change |
|------|--------|
| `src/commands/new.ts` | Full `--plan-first` implementation |
| `src/commands/approve.ts` | Full approval + execution spawn |
| `src/commands/reject.ts` | Full rejection with feedback |
| `src/utils/agent-state.ts` | Add `plan_file` field to AgentState |
| `src/commands/status.ts` | Show plan file path for awaiting_approval |

---

## Future Considerations

### 1. Plan Validation

Could add automated validation:
- Check plan file exists and has required sections
- Validate file paths in plan match actual codebase
- Warn if planned changes overlap with other agents

### 2. Re-planning Flow

After rejection, options:
- Re-spawn in same worktree with updated task
- Create new worktree with feedback incorporated
- Manual editing of plan and re-approval

### 3. Plan Expiration

Plans could expire after a timeout:
- Stale plans become invalid
- Brain must re-request planning
- Prevents acting on outdated analysis

### 4. Integration with Issue 4 (Memory)

Plans could be stored in shared memory:
- Brain can see all subagent plans in one place
- Plans persist for learning and reference
- Historical plans inform future planning

### 5. Plan Diffs

For re-planning:
- Show diff between old and new plan
- Highlight what changed after feedback
- Help brain understand subagent's adjustments

---

## References

- [Claude Code Plan Mode](https://code.claude.com/docs/en/common-workflows)
- [Permission Modes](https://code.claude.com/docs/en/iam)
- [Issue 6 in ISSUES.md](./ISSUES.md)
- [Architecture Overview](./ARCHITECTURE.md)
