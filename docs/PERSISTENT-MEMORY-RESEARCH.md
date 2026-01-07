# Persistent Memory for GitterFlow: Research Document

**Status:** Research Complete
**Date:** 2026-01-07
**Issue:** #4 from ISSUES.md
**Reference:** https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

---

## Executive Summary

This document evaluates approaches for implementing persistent memory to enable brain-subagent knowledge sharing in GitterFlow. After analyzing the Claude Memory Tool API, file-based approaches, and MCP server options, **I recommend a file-based memory approach** as the primary solution, with the option to add an MCP server wrapper in a later phase.

**Key Finding:** The Claude Memory Tool is a client-side API requiring custom implementation handlers. For GitterFlow's use case (Claude Code CLI agents in separate worktrees), a simple file-based approach provides the same benefits with less complexity, and can be enhanced with an MCP server later if needed.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Claude Memory Tool Analysis](#2-claude-memory-tool-analysis)
3. [File-Based Memory Approach](#3-file-based-memory-approach)
4. [MCP Server Approach](#4-mcp-server-approach)
5. [Integration with Existing Commands](#5-integration-with-existing-commands)
6. [Recommended Approach](#6-recommended-approach)
7. [Implementation Steps](#7-implementation-steps)
8. [Impact on Phase 2 Work](#8-impact-on-phase-2-work)

---

## 1. Problem Statement

### Current Limitations

Brain and subagents have no shared persistent memory across sessions. Each agent starts fresh without context about:

- What the brain learned about the project
- Decisions made by other agents
- Patterns and preferences discovered
- Progress on long-running tasks

### Desired Capabilities

1. **Brain Context Sharing**: Brain can share architectural knowledge and task context with subagents
2. **Subagent Learning**: Subagents can record what they learned for future reference
3. **Cross-Session Persistence**: Knowledge survives agent restarts
4. **Multi-Agent Coordination**: Agents can see what others are working on

---

## 2. Claude Memory Tool Analysis

### 2.1 How It Works

The Claude Memory Tool (beta) is a **client-side tool** that enables Claude to store and retrieve information across conversations. Key characteristics:

| Aspect | Details |
|--------|---------|
| **Type** | Client-side (you control storage) |
| **API Header** | `anthropic-beta: context-management-2025-06-27` |
| **Tool Type** | `memory_20250818` |
| **Operations** | `view`, `create`, `str_replace`, `insert`, `delete`, `rename` |
| **Storage** | Developer-implemented `/memories` directory |

### 2.2 How Memory Operations Work

When Claude has the memory tool enabled:

1. **On startup**: Claude automatically views `/memories` to check for context
2. **During work**: Claude creates/updates memory files to record progress
3. **Your handler**: Executes the actual file operations and returns results

Example interaction:
```json
// Claude sends:
{
  "type": "tool_use",
  "name": "memory",
  "input": {
    "command": "view",
    "path": "/memories"
  }
}

// Your handler returns:
{
  "type": "tool_result",
  "content": "Here're the files and directories...\n1.5K\t/memories/project-context.md"
}
```

### 2.3 Compatibility with Claude Code CLI

**Finding: Not directly compatible.**

The Claude Memory Tool requires:
1. Custom API requests with beta header
2. Handler implementation for each memory command
3. Integration with your orchestration code

Claude Code CLI:
- Uses its own API integration
- Provides built-in tools (Read, Write, Edit, Bash, etc.)
- Does not expose the memory tool interface

**Implication:** To use the memory tool with Claude Code, you would need to:
- Create an MCP server that implements memory operations
- Configure the MCP server in Claude Code settings
- OR use the file-based approach with Claude Code's native Read/Write tools

### 2.4 Storage Requirements

The memory tool itself has no specific storage requirements - it's a **protocol** that your handler implements. However, Anthropic recommends:

| Consideration | Recommendation |
|---------------|----------------|
| **Path security** | Validate all paths start with `/memories` |
| **Size limits** | Implement maximum file size limits |
| **Cleanup** | Clear unused memory files periodically |
| **Traversal protection** | Reject `../` and encoded traversal attempts |

---

## 3. File-Based Memory Approach

### 3.1 Proposed Directory Structure

```
.gitterflow/
├── agents/                      # Existing agent state (YAML)
│   ├── worktree-abc.yaml
│   └── worktree-xyz.yaml
├── memories/                    # NEW: Shared memory files
│   ├── project/                 # Project-wide knowledge
│   │   ├── architecture.md      # System architecture understanding
│   │   ├── patterns.md          # Code patterns and conventions
│   │   └── decisions.md         # Key decisions with rationale
│   ├── brain/                   # Brain-specific context
│   │   ├── task-breakdown.md    # Current task decomposition
│   │   ├── progress.md          # Overall progress tracking
│   │   └── learnings.md         # What brain has learned
│   └── agents/                  # Per-agent memories
│       ├── worktree-abc/
│       │   ├── approach.md      # How agent solved the task
│       │   └── issues.md        # Problems encountered
│       └── worktree-xyz/
│           └── ...
```

### 3.2 Brain-Subagent Memory Flow

```
+-----------------------------------------------------------------------+
|  BRAIN (main repo)                                                     |
|  1. Reads /memories/project/* to understand codebase                  |
|  2. Writes /memories/brain/task-breakdown.md with sub-task context    |
|  3. Spawns subagents with gf new --task "..." --autonomous            |
|  4. On wake: reads /memories/agents/* to see what was learned         |
|  5. Updates /memories/brain/progress.md with new state                |
+-----------------------------------------------------------------------+
                              |
          +-------------------+-------------------+
          v                   v                   v
+------------------+ +------------------+ +------------------+
|  SUBAGENT 1      | |  SUBAGENT 2      | |  SUBAGENT 3      |
|                  | |                  | |                  |
| Reads:           | | Reads:           | | Reads:           |
| - project/*      | | - project/*      | | - project/*      |
| - brain/task-*   | | - brain/task-*   | | - brain/task-*   |
|                  | |                  | |                  |
| Writes:          | | Writes:          | | Writes:          |
| - agents/self/*  | | agents/self/*    | | - agents/self/*  |
+------------------+ +------------------+ +------------------+
```

### 3.3 Worktree Coordination

**Option A: Symlink the memories directory (Recommended)**

Add `.gitterflow/memories` to symlinked files so all worktrees share the same memory:

```yaml
# .gitterflow.yaml
symlink_files:
  - .claude
  - .gitterflow/memories  # NEW
```

Pros:
- All agents see the same memories immediately
- No sync needed
- Simple implementation

Cons:
- Potential race conditions on concurrent writes
- File locking may be needed for safety

**Option B: Copy + Merge**

Copy memories on worktree creation, merge on completion:

```
gf new  -> copies .gitterflow/memories to worktree
gf ready -> syncs agent memories back to main repo
```

Pros:
- No concurrent write issues
- Clear snapshot at worktree creation

Cons:
- Subagents don't see each other's progress
- Merge logic needed

### 3.4 Memory Content Examples

**`/memories/project/patterns.md`:**
```markdown
# Project Code Patterns

## Testing
- Uses bun:test with describe/test blocks
- Mocks shell commands via exec parameter injection
- Coverage threshold: 80%

## Error Handling
- Throws Error with descriptive messages
- Uses stderr for user-facing errors
- Exit codes: 0=success, 1=failure

## Naming Conventions
- Commands: verbCommand (newCommand, finishCommand)
- Utils: camelCase functions
- Types: PascalCase interfaces

## File Structure
- Commands in src/commands/
- Utilities in src/utils/
- Tests alongside source files (*.test.ts)
```

**`/memories/brain/task-breakdown.md`:**
```markdown
# Current Task: Implement Persistent Memory

## Status: In Progress

## Breakdown
1. [DONE] Research Claude Memory Tool API
2. [DONE] Evaluate file-based vs MCP approaches
3. [IN PROGRESS] Document findings
4. [PENDING] Update SKILL.md with memory instructions
5. [PENDING] Implement memory directory initialization

## Context for Subagents
- This is Issue #4 from docs/ISSUES.md
- Builds on existing agent-state.ts patterns
- Should integrate with gf ready and notify-complete flow
```

**`/memories/agents/worktree-abc/approach.md`:**
```markdown
# Task: Implement shell completions

## Approach Taken
1. Created completions directory structure
2. Used Bun's shell completion patterns as reference
3. Implemented bash, zsh, and fish completions

## Key Decisions
- Used dynamic completion for branch names
- Static completions for command names
- Separated completion logic into utils/completions.ts

## Files Changed
- src/utils/completions.ts (new)
- src/commands/completions.ts (new)
- tests/unit/utils/completions.test.ts (new)

## Challenges
- Fish completion syntax differs significantly
- Had to handle spaces in branch names
```

---

## 4. MCP Server Approach

### 4.1 Architecture

An MCP (Model Context Protocol) server could provide a standardized memory interface:

```
+------------------+     +----------------------+     +------------------+
| Claude Code      | --> | GitterFlow Memory    | --> | .gitterflow/     |
| (any worktree)   |     | MCP Server           |     | memories/        |
+------------------+     +----------------------+     +------------------+
```

### 4.2 MCP Server Implementation Sketch

```typescript
// packages/memory-mcp/src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server({
  name: "gitterflow-memory",
  version: "0.1.0",
});

// Tool: view memory directory or file
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_view",
      description: "View memory directory or file contents",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to /memories" }
        }
      }
    },
    {
      name: "memory_write",
      description: "Write to a memory file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  ]
}));
```

### 4.3 Complexity vs Benefits

| Aspect | File-Based | MCP Server |
|--------|------------|------------|
| **Setup Complexity** | Low - just symlinks | Medium - MCP server config |
| **Agent Access** | Native Read/Write tools | MCP tools (memory_view, etc.) |
| **Path Validation** | Manual in SKILL.md | Built into server |
| **Cross-Agent Safety** | Requires care | Can enforce locking |
| **Maintenance** | Minimal | Server process + updates |
| **Debugging** | Easy - just files | Need to inspect MCP comms |

**Verdict:** MCP server adds complexity without significant benefit for Phase 1. Consider for Phase 2 if:
- Need file locking for concurrent access
- Want to add validation/sanitization
- Building memory search/indexing features

---

## 5. Integration with Existing Commands

### 5.1 `gf started` - Read Brain Context

The `gf started` command runs when a subagent's Claude session begins (via Start hook). It could read brain context:

**Current behavior:**
```typescript
// Just updates status from pending to running
await writeAgentState({
  ...state,
  status: "running",
  started_at: new Date().toISOString(),
});
```

**Potential enhancement:**
```typescript
// On startup, check if brain left context for this task
const brainContext = await readMemoryFile("brain/task-breakdown.md");
if (brainContext) {
  // The subagent would naturally read this via its SKILL.md instructions
  // No code change needed here - just document in SKILL.md
}
```

**Recommendation:** No code change needed. Add SKILL.md instructions for subagents to read `/memories/brain/` on startup.

### 5.2 `gf ready` - Write Agent Learnings

The `gf ready` command marks work as complete. It could trigger memory writing:

**Current behavior:**
```typescript
// Commits changes and updates status to "ready"
await commitUncommittedChanges(run, stdout);
await updateAgentStatus(currentBranch, "ready", rootDir);
```

**Potential enhancement:**
```typescript
// Before marking ready, remind agent to write learnings
stdout("Tip: Consider writing learnings to .gitterflow/memories/agents/{branch}/");
```

**Recommendation:** Keep `gf ready` simple. Add SKILL.md instructions for subagents to write learnings before calling `gf ready`.

### 5.3 `gf notify-complete` (Proposed)

The `notify-complete` command (mentioned in Issue 3) should report what was done. Memory integration:

**Proposed behavior:**
```typescript
export async function notifyComplete(branch: string) {
  // 1. Read agent's memory files to understand what was done
  const agentMemoryDir = `.gitterflow/memories/agents/${branch}`;
  const approach = await readFile(`${agentMemoryDir}/approach.md`);

  // 2. Update agent state with summary
  await updateAgentStatus(branch, "ready", {
    summary: extractSummary(approach)
  });

  // 3. Touch wake file or send notification
  await touchFile(".gitterflow/brain-wake");
}
```

### 5.4 SKILL.md Updates

Add memory instructions to `.claude/skills/gitterflow/SKILL.md`:

```markdown
## Memory System

GitterFlow maintains shared memory in `.gitterflow/memories/` for brain-subagent knowledge sharing.

### For Sub-Agents: Reading Context

On startup, check for brain context:
\`\`\`bash
# Read brain's task breakdown for context about your work
cat .gitterflow/memories/brain/task-breakdown.md

# Read project patterns to follow conventions
cat .gitterflow/memories/project/patterns.md
\`\`\`

### For Sub-Agents: Recording Learnings

Before running `gf ready`, document what you learned:
\`\`\`bash
# Create your agent memory directory
mkdir -p .gitterflow/memories/agents/$(git branch --show-current)

# Write your approach
cat > .gitterflow/memories/agents/$(git branch --show-current)/approach.md << 'EOF'
# Task: [Your task description]

## Approach Taken
- Step 1...
- Step 2...

## Key Decisions
- Decision 1: reasoning
- Decision 2: reasoning

## Files Changed
- file1.ts - description
- file2.ts - description
EOF
\`\`\`

### For Brain Agents: Using Memory

1. **Before spawning subagents:**
   - Write task breakdown to `.gitterflow/memories/brain/task-breakdown.md`
   - Include context that subagents will need

2. **After subagent completion:**
   - Read `.gitterflow/memories/agents/{branch}/approach.md`
   - Incorporate learnings into project knowledge

3. **Maintain project knowledge:**
   - Update `.gitterflow/memories/project/` with patterns discovered
   - Keep decisions documented for future reference
```

---

## 6. Recommended Approach

### Primary Recommendation: **File-Based Memory with Symlinks**

| Phase | Implementation | Effort |
|-------|----------------|--------|
| **Phase 1** (Now) | File-based memory with symlinks | Low |
| **Phase 2** (Later) | Optional MCP server for locking/search | Medium |
| **Phase 3** (Future) | Integration with Claude Memory Tool API | High |

### Justification

1. **Simplicity**: File-based approach works with existing Claude Code tools (Read, Write)
2. **Compatibility**: No changes to how agents are spawned
3. **Immediate Value**: Brain and subagents can share knowledge today
4. **Incremental**: Can add MCP server later without breaking changes
5. **Alignment**: Matches GitterFlow's existing file-based state management pattern

### Why Not Claude Memory Tool API Directly?

The Claude Memory Tool is designed for:
- Custom orchestrators using Anthropic SDK directly
- Applications that manage their own API calls

GitterFlow uses Claude Code CLI, which:
- Has its own tool set (Read, Write, Edit, Bash, etc.)
- Doesn't expose the memory tool interface
- Already handles file operations well

**Bottom line:** The memory tool API solves the same problem we're solving with files, but requires more infrastructure. Files are simpler for our use case.

---

## 7. Implementation Steps

### Phase 1: File-Based Memory (1-2 days)

1. **Create memory directory structure**
   ```bash
   mkdir -p .gitterflow/memories/{project,brain,agents}
   ```

2. **Add to symlink_files**
   ```yaml
   # .gitterflow.yaml
   symlink_files:
     - .claude
     - .gitterflow/memories
   ```

3. **Update SKILL.md** with memory instructions (see Section 5.4)

4. **Seed initial project memory**
   ```bash
   # Create initial project knowledge
   echo "# Project Patterns\n\n(To be filled by brain/subagents)" > .gitterflow/memories/project/patterns.md
   ```

5. **Add to .gitignore** (optional - may want to track memories)
   ```
   # Or track them - useful for long-running projects
   # .gitterflow/memories/agents/  # Agent-specific (transient)
   ```

### Phase 2: Enhanced Features (Future)

1. **Memory cleanup command**
   ```bash
   gf memory cleanup  # Remove old agent memories
   ```

2. **Memory search**
   ```bash
   gf memory search "error handling"  # Search across memories
   ```

3. **MCP Server** (if concurrent access becomes an issue)
   - File locking for safety
   - Search indexing
   - Memory expiration

---

## 8. Impact on Phase 2 Work

### 8.1 Impact on notify-complete (Issue 3)

**Current Status:** Not implemented
**With Memory:** Enhance to read agent memories and report summary

```typescript
// Proposed enhancement to notify-complete
async function notifyComplete(branch: string) {
  const agentDir = `.gitterflow/memories/agents/${branch}`;

  // Read what the agent accomplished
  const approachFile = join(agentDir, "approach.md");
  if (existsSync(approachFile)) {
    const approach = await Bun.file(approachFile).text();
    // Could extract summary for notification
  }

  // Update state and notify brain
  await updateAgentStatus(branch, "ready");
  await touchWakeFile();
}
```

### 8.2 Impact on Init Hooks (Issue 3)

**Current Status:** Partial (gf started exists)
**With Memory:**

1. **Start Hook**: Could log to memory that agent started
2. **Stop Hook**: Should trigger memory write before completion

Proposed `.claude/settings.json`:
```json
{
  "hooks": {
    "Start": [{
      "type": "command",
      "command": "gf started"
    }],
    "Stop": [{
      "type": "command",
      "command": "echo 'Remember to write learnings to .gitterflow/memories/agents/'"
    }]
  }
}
```

### 8.3 Impact on Safe Merge Strategy (Issue 5)

**Already Done:** `gf ready` command exists
**With Memory:** Brain can read agent memories before merging to understand changes better

Brain merge workflow:
1. Check `gf status` for ready agents
2. Read `.gitterflow/memories/agents/{branch}/approach.md`
3. Understand what was changed and why
4. Merge with full context

### 8.4 Updated Phase 2 Priority

| Priority | Task | Memory Impact |
|----------|------|---------------|
| 1 | **Add memory directory + symlinks** | Foundation for everything |
| 2 | **Update SKILL.md** | Enable brain/subagent memory use |
| 3 | Implement notify-complete | Uses memory for reporting |
| 4 | Add init hooks | Triggers memory reads/writes |
| 5 | Memory cleanup command | Maintenance feature |

---

## 9. Conclusion

Persistent memory for GitterFlow is best implemented as a **file-based system with symlinks**, aligning with the existing architecture patterns. This approach:

1. **Works Today**: Uses Claude Code's native Read/Write tools
2. **Requires Minimal Code**: Primarily SKILL.md documentation
3. **Enables Knowledge Sharing**: Brain and subagents can share context
4. **Supports Future Enhancement**: Can add MCP server later if needed

The Claude Memory Tool API, while powerful, is designed for direct SDK integration and adds unnecessary complexity for GitterFlow's CLI-based architecture. The file-based approach provides the same benefits with a simpler implementation path.

---

## References

- [Claude Memory Tool Documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic SDK Python Examples](https://github.com/anthropics/anthropic-sdk-python/blob/main/examples/memory/basic.py)
- [Anthropic SDK TypeScript Examples](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools-helpers-memory.ts)
- [GitterFlow ISSUES.md](/docs/ISSUES.md)
- [GitterFlow ARCHITECTURE.md](/docs/ARCHITECTURE.md)
- [Agent SDK Evaluation](/docs/AGENT-SDK-EVALUATION.md)
