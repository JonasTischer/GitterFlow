# GitterFlow Analysis & Improvement Proposals

**Analyzed by:** Clawd (AI Agent)
**Date:** 2026-01-31
**Branch:** `clawd/improvements`

## Project Overview

GitterFlow is a CLI tool for orchestrating AI coding agents using Git worktrees. It enables parallel development by isolating each agent's work in its own worktree, then merging changes back when complete.

### Current Features (Working)
- `gf new` - Create worktree with optional task and autonomous mode
- `gf list` - List active worktrees
- `gf status` - Show agent states
- `gf finish` - Merge and cleanup worktree
- `gf delete` - Remove worktree
- `gf snap` - AI-generated commit messages
- `gf started/ready/approve/reject/mark-failed` - Agent lifecycle commands

### Architecture Highlights
- Clean command pattern with `CommandDefinition` interface
- Agent state tracking via JSON files in `.gitterflow/agents/`
- Terminal spawning abstraction (iTerm, Terminal.app, gnome-terminal)
- IDE integration (Cursor, VSCode)
- Claude Code trust pre-configuration

## Improvement Proposals

### 1. 🔴 HIGH: Implement `--plan-first` Mode (Stubbed but incomplete)

**Current State:** Flag exists but shows warning "not yet implemented"

**Proposed Implementation:**
```typescript
// When --plan-first is set:
// 1. Start Claude with --permission-mode plan
// 2. Add system prompt to write plan to .gitterflow/plans/<branch>.md
// 3. Set status to "awaiting_approval"
// 4. Brain agent uses gf approve/reject to control execution
```

**Files to modify:**
- `src/commands/new.ts` - Implement plan-first logic
- `src/commands/approve.ts` - Transition from plan to execution
- `src/utils/agent-state.ts` - Add plan-related states

---

### 2. 🟡 MEDIUM: Add Clawdbot/OpenClaw Integration

**Use Case:** When running GitterFlow from within a Clawdbot agent, enable:
- Notifications via Clawdbot channels when sub-agents complete
- Status queries via Clawdbot sessions
- Brain agent coordination through Clawdbot's session system

**Proposed Implementation:**
```typescript
// src/integrations/clawdbot.ts
export async function notifyCompletion(branch: string, status: 'success' | 'failed') {
  // Check if CLAWDBOT_SESSION is set
  // Use sessions_send to notify parent session
}
```

**Config addition:**
```yaml
notifications:
  clawdbot: true  # Notify via Clawdbot if running as sub-agent
  webhook: null   # Optional webhook URL
```

---

### 3. 🟡 MEDIUM: Add Webhook Notifications

**Use Case:** Notify external systems when agents complete

**Proposed Implementation:**
```typescript
// src/utils/notifications.ts
export async function notifyWebhook(event: AgentEvent) {
  const webhookUrl = getSetting('webhook_url');
  if (!webhookUrl) return;
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
}
```

---

### 4. 🟢 LOW: Enhanced Status Display

**Current:** Basic table of agent states
**Proposed:** Add:
- Time elapsed since started
- Last activity timestamp
- Task summary (truncated)
- Color-coded status

---

### 5. 🟢 LOW: Add `gf spawn` for Batch Worktree Creation

**Use Case:** Brain agent creating multiple sub-agents at once

```bash
gf spawn --tasks tasks.json
# Where tasks.json contains array of { branch, task, autonomous }
```

---

### 6. 🟢 LOW: Add `gf watch` Command

**Use Case:** Continuously monitor all agent states

```bash
gf watch  # Live-updating status display
```

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| 1 | --plan-first mode | Medium | High |
| 2 | Webhook notifications | Low | Medium |
| 3 | Enhanced status | Low | Medium |
| 4 | Clawdbot integration | Medium | Medium |
| 5 | gf spawn | Medium | Low |
| 6 | gf watch | Low | Low |

## Next Steps

1. Implement `--plan-first` mode (addresses existing TODO)
2. Add webhook notifications (quick win)
3. Enhance status display (quick win)

---

*Analysis complete. Ready to implement upon approval.*
