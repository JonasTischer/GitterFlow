# Claude Agent SDK Evaluation for GitterFlow

**Status:** Research Complete
**Date:** 2025-01-07
**Author:** Claude (Opus 4.5)
**Issue:** #7 from ISSUES.md

---

## Executive Summary

After thorough evaluation of the Claude Agent SDK capabilities against GitterFlow's current architecture and future needs, **I recommend a Hybrid Approach**: keep GitterFlow as the worktree orchestration layer while selectively integrating SDK capabilities for specific use cases.

**Key Finding:** The Claude Agent SDK excels at programmatic agent control and parallel subagent execution, but lacks native support for per-agent working directories—a critical requirement for GitterFlow's worktree-based isolation model.

---

## 1. Claude Agent SDK Overview

The Claude Agent SDK provides programmatic control over Claude agents with these core capabilities:

### 1.1 Subagent Spawning (Task Tool)

```python
async for message in query(
    prompt="Implement features A, B, C in parallel",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Glob", "Grep", "Task"],
        agents={
            "implementer": AgentDefinition(
                description="Implements features in isolation",
                prompt="Implement the assigned feature.",
                tools=["Read", "Edit", "Write", "Bash"]
            )
        }
    )
):
    handle_message(message)
```

**Capabilities:**
- Native parallel subagent execution
- Tool restrictions per agent type (read-only reviewers vs. code writers)
- Context isolation between subagents
- Automatic result aggregation

### 1.2 Hooks as Callbacks

SDK hooks are **Python/TypeScript callback functions**, not shell commands:

```python
async def protect_env_files(input_data, tool_use_id, context):
    if input_data['tool_name'] == 'Write':
        file_path = input_data['tool_input'].get('file_path', '')
        if file_path.endswith('.env'):
            return {
                'hookSpecificOutput': {
                    'permissionDecision': 'deny',
                    'permissionDecisionReason': 'Cannot modify .env files'
                }
            }
    return {}
```

**Available Hook Events:**
| Event | Description | Use Case |
|-------|-------------|----------|
| `PreToolUse` | Before tool execution | Block/modify operations |
| `PostToolUse` | After tool execution | Logging, auditing |
| `SubagentStart` | When subagent spawns | Track parallel work |
| `SubagentStop` | When subagent completes | **Brain-subagent coordination** |
| `SessionStart/End` | Lifecycle events | Initialization, cleanup |

### 1.3 Session Management

```python
# Resume a session with full context
async for message in query(
    prompt="Try a different approach",
    options=ClaudeAgentOptions(
        resume=session_id,
        fork_session=True  # Branch without modifying original
    )
):
    print(message)
```

**Features:**
- Sessions persist to disk (~/.claude/projects/)
- Resume with `resume: session_id`
- Fork sessions for branching conversations
- Automatic context management

### 1.4 Permission Control

Four complementary mechanisms:

1. **Permission Modes:** `default`, `acceptEdits`, `bypassPermissions`, `plan`
2. **canUseTool Callback:** Runtime decision-making
3. **PreToolUse Hooks:** Fine-grained blocking/modification
4. **Permission Rules:** Declarative allow/deny in settings

---

## 2. Current GitterFlow Architecture

### 2.1 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│  GitterFlow CLI (Bun/TypeScript)                            │
│                                                             │
│  Commands:                                                  │
│  ├── gf new      → Creates worktree + spawns Claude CLI    │
│  ├── gf finish   → Commits, merges, cleans up              │
│  ├── gf status   → Shows agent states                      │
│  ├── gf list     → Lists worktrees                         │
│  └── gf delete   → Removes worktree                        │
│                                                             │
│  State:                                                     │
│  └── .gitterflow/agents/{branch}.yaml                      │
│      (AgentState: branch, task, status, timestamps)        │
│                                                             │
│  Isolation:                                                 │
│  └── Git worktrees (each agent in separate directory)      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Agent Spawning Flow (src/commands/new.ts)

```typescript
// 1. Create git worktree for isolation
await run`git worktree add -b ${branch} ${worktreePath}`;

// 2. Store base branch in git config
await run`git config branch.${branch}.gitterflow-base-branch ${currentBranch}`;

// 3. Create symlinks for shared files
createSymlinks(mainRepoPath, worktreePath, symlinkFiles);

// 4. Pre-trust worktree in Claude Code
await preTrustWorktree(worktreePath);

// 5. Write initial agent state (for --autonomous mode)
await writeAgentState({ branch, task, status: "pending", ... });

// 6. Spawn terminal with Claude CLI
spawnTerminal(worktreePath, `claude --permission-mode acceptEdits "${task}"`);
```

**Key Characteristics:**
- Uses OS terminal spawning (iTerm, VSCode, etc.)
- Claude CLI as subprocess, not programmatic control
- File-based state management (YAML)
- No direct callback mechanism between agents

### 2.3 Agent State Management (src/utils/agent-state.ts)

```typescript
interface AgentState {
  branch: string;
  task: string;
  status: "pending" | "running" | "completed" | "failed" | "conflict" | "merged";
  started_at: string;
  spawned_at?: string;
  completed_at?: string;
  worktree_path: string;
  base_branch: string;
  error?: string;
}
```

**Characteristics:**
- YAML files in `.gitterflow/agents/`
- Polling-based status checks (`gf status`)
- No push-based notifications

---

## 3. Feature Comparison

| Feature | Claude Agent SDK | Current GitterFlow |
|---------|-----------------|-------------------|
| **Subagent Spawning** | Native `Task` tool with programmatic control | CLI spawning (`claude` command in terminal) |
| **Parallel Execution** | Built-in, managed by SDK | Independent terminal processes |
| **Working Directories** | Single `working_dir` for all agents ❌ | Isolated worktrees per agent ✅ |
| **Hooks** | Callback functions (Python/TS) | Shell commands (limited) |
| **Agent Communication** | Through Claude's reasoning | File-based state (YAML) |
| **Completion Notification** | `SubagentStop` hook ✅ | Polling `gf status` only |
| **Session Persistence** | Built-in resume/fork | None (fresh sessions) |
| **Permission Control** | Rich programmatic API | CLI flags + settings.json |
| **Tool Restrictions** | Per-agent tool lists | Same for all agents |
| **Error Handling** | Try/catch in callbacks | Exit codes + state files |
| **Plan Mode** | `permission_mode: plan` | CLI `--permission-mode plan` |

---

## 4. Key Questions Evaluated

### 4.1 Can SDK Subagents Work in Different Directories (Worktrees)?

**Answer: Not natively supported.**

The SDK provides a single `working_dir` configuration option:

```python
ClaudeAgentOptions(
    working_dir="/path/to/project",  # Single directory for all
)
```

**Critical Gap:** There's no way to configure per-subagent working directories. All subagents share the same working directory context.

**Workaround Options:**
1. **Bash tool chdir:** Have subagents `cd` to their worktree, but this is fragile
2. **Separate SDK instances:** Run independent SDK processes for each worktree (defeats purpose)
3. **Custom tool wrapper:** Create a GitterFlow MCP server that manages directory context

### 4.2 How Does SDK Handle Parallel Agents?

**Answer: Excellent native support.**

From the documentation:
> "Multiple subagents can run concurrently, dramatically speeding up complex workflows"

Example parallel execution:
```python
agents={
    "style-checker": AgentDefinition(..., tools=["Read", "Grep"]),
    "security-scanner": AgentDefinition(..., tools=["Read", "Bash"]),
    "test-runner": AgentDefinition(..., tools=["Bash", "Read"])
}
```

**Best Practice:** "Run subagents in parallel only for disjoint slugs (different modules/files)"

This aligns well with GitterFlow's worktree model where each agent handles independent files.

### 4.3 What's the Migration Path from CLI to SDK?

**Three Potential Paths:**

| Path | Effort | Risk | Benefit |
|------|--------|------|---------|
| **A. Full Rewrite** | High | High | Maximum SDK integration |
| **B. Hybrid (Recommended)** | Medium | Low | Best of both worlds |
| **C. SDK for Brain Only** | Low | Low | Improved orchestration |

**Recommended: Path B (Hybrid)**

```
┌────────────────────────────────────────────────────────────────┐
│  GitterFlow (keeps worktree management)                        │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Brain Agent (NEW: uses Agent SDK)                        │ │
│  │  - SubagentStop hooks for completion callbacks            │ │
│  │  - Session persistence for context                        │ │
│  │  - Programmatic orchestration                             │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                      │
│         ┌───────────────┼───────────────┐                     │
│         ▼               ▼               ▼                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐              │
│  │ Claude CLI │  │ Claude CLI │  │ Claude CLI │              │
│  │ (worktree) │  │ (worktree) │  │ (worktree) │              │
│  └────────────┘  └────────────┘  └────────────┘              │
│                                                                │
│  Git worktrees still provide isolation                        │
│  SDK brain provides orchestration                             │
└────────────────────────────────────────────────────────────────┘
```

### 4.4 Trade-offs: Complexity vs Capability

| Aspect | CLI Approach (Current) | SDK Approach |
|--------|------------------------|--------------|
| **Simplicity** | ✅ Simple shell spawning | ❌ Requires Python/TS runtime |
| **User Familiarity** | ✅ Standard terminal workflow | ⚠️ Different interaction model |
| **Directory Isolation** | ✅ Native worktree support | ❌ Requires workarounds |
| **Agent Coordination** | ❌ Polling only | ✅ Callback hooks |
| **Error Handling** | ⚠️ Exit codes + files | ✅ Programmatic try/catch |
| **Plan Approval** | ❌ No built-in flow | ⚠️ Still needs custom logic |
| **Session Memory** | ❌ Fresh each time | ✅ Built-in persistence |
| **Permissions** | ⚠️ CLI flags only | ✅ Rich programmatic control |

---

## 5. Impact on Open Issues

Evaluating how SDK adoption would affect Issues 1-6 from ISSUES.md:

### Issue 1: Merge Commit Messages Are Too Generic

**SDK Impact:** Neutral
SDK doesn't change merge mechanics. Still need to implement custom merge messages.

### Issue 2: Subagent Permission Inheritance

**SDK Impact:** ✅ Solved
SDK's `allowed_tools` and permission modes can be set programmatically per agent:
```python
agents={
    "subagent": AgentDefinition(
        tools=["Read", "Edit", "Write", "Bash"],  # Explicit permissions
    )
}
```

### Issue 3: Brain-Subagent Orchestration Loop

**SDK Impact:** ✅ Significantly Improved
`SubagentStart`/`SubagentStop` hooks provide direct callbacks:
```python
async def on_subagent_complete(result, context):
    # Brain immediately notified when subagent finishes
    await wake_brain(result)
```

No more polling for status changes.

### Issue 4: Persistent Memory

**SDK Impact:** ✅ Partially Solved
SDK session management provides built-in persistence:
```python
ClaudeAgentOptions(resume=session_id)
```

However, cross-agent memory still needs shared file storage.

### Issue 5: Safe Merge Strategy (Brain-Controlled Merges)

**SDK Impact:** ⚠️ Partial
SDK enables brain to control when subagents complete, but git operations still happen in worktrees. Need hybrid: SDK brain decides when to merge, GitterFlow executes the merge.

### Issue 6: Subagent Plan-Then-Execute with Brain Approval

**SDK Impact:** ⚠️ Partial
SDK supports `permission_mode: plan`, but approval workflow still needs implementation:
```python
# Subagent in plan mode
ClaudeAgentOptions(permission_mode="plan")

# Brain must still implement approval logic
```

---

## 6. Recommendation

### Primary Recommendation: **Hybrid Approach**

**Keep GitterFlow for:**
1. Git worktree management (isolation is critical)
2. Terminal spawning (user-familiar workflow)
3. Merge operations (git-aware)
4. Agent state persistence (`.gitterflow/agents/`)

**Adopt SDK for:**
1. Brain agent orchestration (if building an advanced orchestrator)
2. Hook-based coordination (SubagentStop callbacks)
3. Session persistence (resume long-running work)
4. Permission management (programmatic control)

### Implementation Priority

1. **Phase 1: Immediate Wins** (Low Effort)
   - Keep current CLI spawning for subagents
   - Add file-based wake mechanism (Issue 3, Phase 1)
   - Symlink `.claude/settings.json` to worktrees (Issue 2)

2. **Phase 2: SDK Brain** (Medium Effort)
   - Build SDK-based brain orchestrator
   - Use SubagentStop hooks for completion callbacks
   - CLI subagents still use worktrees

3. **Phase 3: Full Integration** (High Effort, Optional)
   - Create GitterFlow MCP server for worktree-aware tools
   - SDK brain spawns SDK subagents with custom directory context
   - Unified programmatic control

### Decision Matrix

| If your priority is... | Recommendation |
|------------------------|----------------|
| Quick wins, user familiarity | Keep CLI, add file-based orchestration |
| Advanced orchestration | SDK for brain, CLI for subagents |
| Maximum control | Full SDK with custom MCP server |
| Minimum complexity | Stay with current architecture |

---

## 7. Technical Appendix

### 7.1 SDK Session Model vs GitterFlow State

**SDK Sessions:**
- Conversation-focused (messages, tool calls)
- Stored in `~/.claude/projects/`
- Resume by session ID
- Fork for branching

**GitterFlow State:**
- Task-focused (branch, status, timestamps)
- Stored in `.gitterflow/agents/`
- No resume (fresh sessions)
- Git-based branching

**Integration Point:** Use SDK sessions for brain, GitterFlow state for subagents.

### 7.2 Working Directory Limitation Workaround

If SDK adoption requires per-agent directories, potential solutions:

```typescript
// Option A: Create MCP server with directory context
const gitterflowServer = {
  tools: {
    worktree_read: (path, worktree) => read(`${worktree}/${path}`),
    worktree_edit: (path, worktree, content) => edit(`${worktree}/${path}`, content),
  }
};

// Option B: Wrapper that spawns separate SDK instances
async function spawnWorktreeAgent(worktreePath, task) {
  const subprocess = spawn('node', ['sdk-agent.js', worktreePath, task]);
  return new Promise((resolve) => {
    subprocess.on('exit', (code) => resolve({ code, worktree: worktreePath }));
  });
}
```

### 7.3 Current GitterFlow Strengths to Preserve

1. **Simple CLI Interface:** `gf new`, `gf finish`, `gf status`
2. **Git-Native Isolation:** Worktrees are first-class git feature
3. **Symlink Sharing:** Efficient file sharing across worktrees
4. **Pre-Trusting:** Seamless Claude Code integration
5. **AI Commit Messages:** OpenRouter integration for smart commits

---

## 8. Conclusion

The Claude Agent SDK offers powerful capabilities for agent orchestration, particularly:
- Native parallel subagent execution
- Callback-based hooks for coordination
- Built-in session management

However, **its lack of per-agent working directory support** makes it unsuitable as a complete replacement for GitterFlow's worktree-based isolation model.

**The recommended path forward is a hybrid approach:**
- GitterFlow remains the worktree orchestration layer
- SDK can optionally power an advanced brain agent
- Git worktrees provide the isolation guarantees
- Incremental adoption minimizes risk

This evaluation suggests **proceeding with Issues 2, 3, 5, and 6 using the current architecture**, with the option to adopt SDK for the brain agent in Phase 2 if advanced orchestration becomes a priority.

---

## References

- [Claude Agent SDK Documentation](https://docs.anthropic.com/en/docs/agents-and-tools/claude-agent-sdk)
- [SDK Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [SDK Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [SDK Sessions](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [SDK Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [GitterFlow ISSUES.md](/docs/ISSUES.md)
