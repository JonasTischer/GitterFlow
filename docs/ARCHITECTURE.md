# GitterFlow Technical Architecture

> Technical implementation details for the agent orchestration system

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Current Architecture](#current-architecture)
3. [Phase 2: Agent Orchestration Design](#phase-2-agent-orchestration-design)
4. [Implementation Specifications](#implementation-specifications)
5. [Gap Analysis](#gap-analysis)
6. [File Reference](#file-reference)

---

## System Overview

GitterFlow is a CLI utility that leverages Git worktrees to enable parallel development workflows. The system evolves in two phases:

| Phase | Focus | Status |
|-------|-------|--------|
| Phase 1 | Human developer tools | Complete |
| Phase 2 | Autonomous agent orchestration | In Progress |

### Core Concept

Git worktrees allow multiple working directories from a single repository. GitterFlow uses this to:

1. **Isolate parallel work** - Each task gets its own directory
2. **Enable parallel AI agents** - Multiple Claude Code instances work simultaneously
3. **Automate merge workflows** - Completed work merges back to base branch

---

## Current Architecture

### Directory Structure

```
project/                          # Main repository
├── .gitterflow.yaml              # Configuration
├── .gitterflow/                  # GitterFlow data (Phase 2)
│   └── agents/                   # Agent state tracking
│       ├── feature-a.yaml
│       └── feature-b.yaml
├── src/
└── ...

../feature-a/                     # Worktree 1
├── (full repo contents)
└── .git → project/.git/worktrees/feature-a

../feature-b/                     # Worktree 2
├── (full repo contents)
└── .git → project/.git/worktrees/feature-b
```

### Command Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                           gf new [branch]                          │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 1. Parse arguments (branch name, --task, --autonomous)             │
│ 2. Generate random branch name if not provided                     │
│ 3. Get current branch (becomes base branch for new worktree)       │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 4. git worktree add -b <branch> ../<branch>                        │
│ 5. git config branch.<branch>.gitterflow-base-branch <current>     │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 6. Create symlinks for configured files (symlink_files config)     │
│ 7. Pre-trust worktree in ~/.claude.json                            │
└────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ 8. Spawn terminal/IDE in worktree directory                        │
│ 9. Run coding agent with optional task prompt                      │
└────────────────────────────────────────────────────────────────────┘
```

### Key Implementation Details

#### Pre-Trust Mechanism

Claude Code stores trusted directories in `~/.claude.json`:

```json
{
  "projects": {
    "/path/to/worktree": {
      "hasTrustDialogAccepted": true
    }
  }
}
```

**Implementation:** `src/utils/claude-trust.ts`

```typescript
export async function preTrustWorktree(worktreePath: string): Promise<void> {
  const configPath = join(homedir(), ".claude.json");
  let config = existsSync(configPath)
    ? JSON.parse(await Bun.file(configPath).text())
    : {};

  config.projects = config.projects || {};
  config.projects[worktreePath] = {
    ...config.projects[worktreePath],
    hasTrustDialogAccepted: true,
  };

  await Bun.write(configPath, JSON.stringify(config, null, 2));
}
```

#### Base Branch Tracking

The base branch (branch from which worktree was created) is stored in git config:

```bash
git config branch.<worktree-branch>.gitterflow-base-branch <base-branch>
```

This allows `gf finish` to know where to merge back without configuration.

#### Terminal Spawning

Terminal spawning uses platform-specific methods:

| Platform | Terminal | Method |
|----------|----------|--------|
| macOS | Terminal.app | AppleScript via `osascript` |
| macOS | iTerm2 | AppleScript via `osascript` |
| Linux | GNOME Terminal | Direct spawn with `--working-directory` |
| Windows | Windows Terminal | `wt.exe` with PowerShell |
| Windows | CMD | `cmd.exe /k` |

**Quote Escaping:** Tasks with quotes are escaped for AppleScript:
```typescript
const escapedAgentCommand = codingAgent.replace(/"/g, '\\"');
```

---

## Phase 2: Agent Orchestration Design

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BRAIN AGENT (Orchestrator)                        │
│                     Running in: /project (main repo)                     │
│                                                                          │
│  1. Analyzes task, creates plan                                          │
│  2. Spawns sub-agents: gf new --task "..." --autonomous                  │
│  3. Monitors status via gf status or file watchers                       │
│  4. Gets notified via hooks when sub-agents complete                     │
│  5. Reviews/approves PRs or handles merge conflicts                      │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │ spawns             │ spawns             │ spawns
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   SUB-AGENT 1   │  │   SUB-AGENT 2   │  │   SUB-AGENT 3   │
│                 │  │                 │  │                 │
│ Worktree:       │  │ Worktree:       │  │ Worktree:       │
│ ../feature-a    │  │ ../feature-b    │  │ ../feature-c    │
│                 │  │                 │  │                 │
│ Task: "Add      │  │ Task: "Fix      │  │ Task: "Write    │
│ retry logic"    │  │ bug #123"       │  │ tests for X"    │
│                 │  │                 │  │                 │
│ On complete:    │  │ On complete:    │  │ On complete:    │
│ → gf finish     │  │ → gf finish     │  │ → gf finish     │
│ → notify brain  │  │ → notify brain  │  │ → notify brain  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Design Decisions

#### 1. Merge Strategy: Direct Merge

```
Sub-agent completes → gf finish → Merges directly to base branch
```

- Fast and simple workflow
- Brain agent handles any merge conflicts
- No PR overhead for internal parallelization

#### 2. Failure Handling: Notify and Stop

```
Sub-agent fails → Leave worktree intact → Update status → Notify brain
```

- Brain can inspect the worktree and decide next steps
- No automatic cleanup of failed work
- Clear error reporting via status files

#### 3. Communication: File-based + Hooks (Hybrid)

**File-based state:**
```yaml
# .gitterflow/agents/feature-a.yaml
branch: feature-a
task: "Implement shell completions"
status: running  # pending | running | completed | failed | conflict | merged
started_at: "2025-01-05T10:30:00Z"
worktree_path: /Users/dev/project/../feature-a
base_branch: main
```

**Hook-based notifications:**
- Claude Code Stop hook triggers `gf notify-complete`
- Updates state file and signals brain agent

### Autonomous Execution Flow

```bash
# What gf new --task "..." --autonomous does:

1. Create worktree (existing behavior)
2. Pre-trust in ~/.claude.json (existing behavior)
3. Write agent metadata to .gitterflow/agents/<branch>.yaml (status: running)
4. Run in terminal:
   cd /path/to/worktree && \
   claude "Your task: ..." && \
   gf finish --no-confirm || gf mark-failed
5. On success: status → completed → merged
6. On failure: status → failed, worktree preserved
7. Trigger notification hook
```

---

## Implementation Specifications

### New Files Required

#### `src/utils/agent-state.ts`

```typescript
interface AgentState {
  branch: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'conflict' | 'merged';
  started_at: string;
  completed_at?: string;
  worktree_path: string;
  base_branch: string;
  error?: string;
}

export async function writeAgentState(branch: string, state: AgentState): Promise<void>;
export async function readAgentState(branch: string): Promise<AgentState | null>;
export async function listAgentStates(): Promise<AgentState[]>;
export async function updateAgentStatus(
  branch: string,
  status: AgentState['status'],
  error?: string
): Promise<void>;
```

**Storage:** `.gitterflow/agents/<branch>.yaml`

#### `src/commands/status.ts`

```bash
$ gf status

AUTONOMOUS AGENTS
──────────────────────────────────────────────────────────────────
Branch                     Status      Task                 Started
──────────────────────────────────────────────────────────────────
shell-completions          running     Implement shell...   2 min ago
retry-logic                completed   Add retry logic...   5 min ago
verbose-mode               failed      Add verbose flag...  3 min ago
──────────────────────────────────────────────────────────────────
```

#### `src/commands/mark-failed.ts`

- Called when autonomous agent fails
- Updates agent state to `status: failed`
- Captures error message if available
- Does NOT clean up worktree (for inspection)

#### `src/commands/notify.ts`

- `gf notify-complete` command
- Reads current branch
- Updates agent state to completed or failed
- Writes notification file for brain agent

#### `.claude/skills/gitterflow.md`

Skill documentation for Claude Code agents:

```markdown
# GitterFlow: Agent Orchestration

When you need to parallelize work across multiple independent tasks.

## Spawn a Sub-Agent
gf new --task "Detailed task description" --autonomous

## Check Status
gf status

## When to Use
- Multiple independent features/fixes
- Large refactoring that can be parallelized
- Tasks that won't conflict with each other

## Important
- Each sub-agent works in isolation (git worktree)
- Sub-agents merge to YOUR CURRENT branch when done
- Check `gf status` to monitor progress
- Failed agents leave worktree intact for inspection
```

### Modifications Required

#### `src/commands/new.ts`

Add `--autonomous` flag:

```typescript
function parseArgs(args: string[]): {
  branch?: string;
  task?: string;
  autonomous?: boolean;
} {
  // ... existing parsing
  if (arg === "--autonomous" || arg === "-a") {
    autonomous = true;
  }
  return { branch, task, autonomous };
}
```

When autonomous:
1. Write initial agent state (status: running)
2. Build command chain: `claude "task" && gf finish --no-confirm || gf mark-failed`
3. Pass to terminal spawner with autonomous flag

#### `src/commands/finish.ts`

Add `--no-confirm` flag:
- Skip all confirmation prompts
- On success: update agent state to `status: merged`
- On conflict: update agent state to `status: conflict`

#### `src/utils/terminal.ts`

Add autonomous command chaining:

```typescript
export function spawnTerminal(
  dir: string,
  agentCommand?: string,
  options?: { autonomous?: boolean }
): void {
  if (options?.autonomous) {
    // Chain: claude "task" && gf finish --no-confirm || gf mark-failed
    const chainedCommand = `${agentCommand} && gf finish --no-confirm || gf mark-failed`;
    // Use chainedCommand instead of agentCommand
  }
}
```

#### `src/commands/init.ts`

Add hooks setup option:

```typescript
// Prompt: "Set up Claude Code hooks for agent orchestration?"
// If yes, create .claude/settings.json with Stop hook
```

---

## Gap Analysis

| Feature | Current State | Gap | Solution |
|---------|---------------|-----|----------|
| Human-friendly workflow | Complete | None | - |
| `--task` flag | Complete | None | - |
| Pre-trust worktrees | Complete | None | - |
| Agents spawn sub-agents | Missing | `--autonomous` flag | Add to `gf new` |
| GitterFlow skill | Missing | No skill file | Create `.claude/skills/gitterflow.md` |
| Sub-agent merges back | Partial | Manual `gf finish` | Chain with `--autonomous` |
| Brain knows status | Missing | No tracking | Add metadata + `gf status` |
| Brain gets notified | Missing | No hooks | Add Stop hook + notification |
| Merge conflict handling | Missing | No detection | Add conflict status |

---

## File Reference

### Source Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point |
| `src/cli.ts` | Command dispatcher |
| `src/config.ts` | Configuration loader |
| `src/commands/new.ts` | Worktree creation + --task |
| `src/commands/finish.ts` | Merge workflow |
| `src/commands/snap.ts` | AI commits |
| `src/commands/list.ts` | List worktrees |
| `src/commands/delete.ts` | Remove worktrees |
| `src/commands/init.ts` | Setup wizard |
| `src/utils/terminal.ts` | Terminal spawning |
| `src/utils/ide.ts` | IDE opening |
| `src/utils/claude-trust.ts` | Pre-trust worktrees |
| `src/utils/symlink.ts` | Symlink creation |

### New Files (Phase 2)

| File | Purpose |
|------|---------|
| `src/utils/agent-state.ts` | Agent metadata management |
| `src/commands/status.ts` | `gf status` command |
| `src/commands/mark-failed.ts` | `gf mark-failed` command |
| `src/commands/notify.ts` | `gf notify-complete` command |
| `.claude/skills/gitterflow.md` | Skill documentation |

### Configuration Files

| File | Purpose |
|------|---------|
| `.gitterflow.yaml` | Project configuration |
| `~/.claude.json` | Claude Code settings (trusted projects) |
| `.claude/settings.json` | Claude Code hooks (for notifications) |

---

## Implementation Priority

| Priority | Task | Files |
|----------|------|-------|
| 1 | Agent state utility | `src/utils/agent-state.ts` |
| 2 | `--autonomous` flag | `src/commands/new.ts` |
| 3 | `gf status` command | `src/commands/status.ts` |
| 4 | `gf mark-failed` command | `src/commands/mark-failed.ts` |
| 5 | Update `gf finish` | `src/commands/finish.ts` |
| 6 | GitterFlow skill | `.claude/skills/gitterflow.md` |
| 7 | `gf notify-complete` | `src/commands/notify.ts` |
| 8 | Update `gf init` | `src/commands/init.ts` |
| 9 | Tests | `tests/unit/...` |

---

## Success Criteria

- [ ] `gf new --task "..." --autonomous` spawns sub-agent that works independently
- [ ] Sub-agent automatically runs `gf finish` when Claude exits
- [ ] Agent state tracked in `.gitterflow/agents/<branch>.yaml`
- [ ] `gf status` shows all running/completed/failed agents
- [ ] Failed agents have status: failed and worktree preserved
- [ ] Merge conflicts result in status: conflict (not merged)
- [ ] GitterFlow skill documented for agent use
- [ ] Tests cover new functionality (80%+ coverage maintained)
