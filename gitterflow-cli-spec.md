# Gitterflow CLI Specification

## Document Control
- **Status:** Draft v0.3
- **Last Updated:** 2025-10-19

## Vision & Summary
Gitterflow CLI (`gf`) enables developers to run multiple AI coding agents in parallel using Git worktrees. Each worktree provides an isolated environment where an agent (like Claude Code or Cursor) can work on a specific feature or task independently. When work is complete, changes merge cleanly back to the base branch.

**Core workflow:**
1. Developer creates a new worktree with `gf create <branch-name>`
2. GitterFlow sets up 3 terminals (dev server, AI editor, manual shell)
3. AI agent works in isolation on the feature
4. Developer runs `gf ship` to merge changes back to base branch
5. Worktree is cleaned up automatically

### Guiding Principles
- **Zero-friction parallel work:** Launch isolated environments in seconds
- **Agent-optimized:** Terminals and tooling configured for AI coding workflows
- **Safe merging:** Fast-forward merges ensure clean history
- **Minimal config:** Sensible defaults, optional customization
- **Terminal-native:** Works in headless mode (tmux) or with GUI editors

## Target Personas & Core Use Cases
| Persona | Needs | Representative Scenarios |
| --- | --- | --- |
| Solo developer | Run multiple agents on different features simultaneously | Frontend agent working on UI while backend agent adds API endpoints |
| Developer switching contexts | Maintain multiple in-progress features without stashing | Quick context switch between bug fix and feature development |
| Team member | Isolate experimental work from main development | Try risky refactor in worktree without affecting main branch |

## Command Reference

### Core Commands (MVP)
| Command | Purpose |
| --- | --- |
| `gf create <branch>` | Create worktree + launch 3-terminal development environment |
| `gf ship [--message]` | Commit, push, and fast-forward merge to base branch |
| `gf list` | Show all active worktrees with status |
| `gf cleanup <branch>` | Remove worktree and clean up resources |
| `gf help` | Display command help |
| `gf version` | Print version information |

### Future Commands (Post-MVP)
| Command | Purpose |
| --- | --- |
| `gf init` | Initialize `.gitterflow.yaml` configuration |
| `gf switch <branch>` | Switch to existing worktree's tmux session |
| `gf sync` | Sync base branch changes into worktree |

## Command Details

### Global Options
- `-h, --help`: Show command-specific help
- `-V, --version`: Print version (shortcut for `gf version`)
- `--config <path>`: Override default configuration file path
- `--mode <headless|window>`: Override launch mode from config

### `gf create <branch-name>`

**Purpose:** Create a new Git worktree and launch a 3-terminal development environment.

**Behavior:**
1. Detect current branch as base branch (store for later merge)
2. Create Git worktree in parallel directory: `../<branch-name>`
3. Find available port (auto-increment from `basePort` in config)
4. Launch terminal environment based on `mode` setting:

**Headless Mode (default: tmux):**
```
┌─────────────────────────────────────┐
│ Pane 1: Dev Server                  │
│ $ bun --hot src/index.ts            │
│ > Server running on port 3001       │
├─────────────────────────────────────┤
│ Pane 2: AI Editor                   │
│ $ cursor .                          │
│                                     │
├─────────────────────────────────────┤
│ Pane 3: Manual Shell                │
│ $ # Ready for manual commands       │
│                                     │
└─────────────────────────────────────┘
```

**Window Mode:**
- Opens new Cursor/VSCode window at worktree path
- Launches integrated terminal with dev server
- Second terminal ready for manual commands

**Options:**
- `--mode <headless|window>`: Override config mode
- `--no-server`: Skip dev server launch
- `--port <number>`: Use specific port instead of auto-increment

**Metadata Storage:**
Store in `.gitterflow/worktrees/<branch>.json`:
```json
{
  "branch": "feature-name",
  "baseBranch": "main",
  "path": "../feature-name",
  "port": 3001,
  "tmuxSession": "gf-feature-name",
  "createdAt": "2025-10-19T10:30:00Z"
}
```

**Exit Codes:**
- `0`: Success
- `1`: Git worktree creation failed
- `2`: Terminal launch failed

---

### `gf ship [--message <msg>]`

**Purpose:** Commit all changes, push to remote, and merge back to base branch using fast-forward merge.

**Behavior:**
1. Run from within worktree directory
2. Read metadata to determine base branch
3. Stage all changes (`git add .`)
4. Commit with message (prompt if not provided)
5. Push to remote: `git push origin <branch>`
6. Switch to base branch
7. Fast-forward merge: `git merge --ff-only <branch>`
8. If fast-forward fails, error and suggest `gf sync` first
9. Kill tmux session (if exists)
10. Remove worktree: `git worktree remove <path>`
11. Clean up metadata file

**Options:**
- `--message <msg>`, `-m <msg>`: Commit message (skip prompt)
- `--no-push`: Skip push to remote
- `--no-cleanup`: Keep worktree after merge (for inspection)
- `--force-merge`: Use regular merge commit instead of fast-forward

**Exit Codes:**
- `0`: Successfully shipped and cleaned up
- `1`: Commit or push failed
- `2`: Fast-forward merge failed (base branch diverged)
- `3`: Cleanup failed (manual intervention needed)

**Example:**
```bash
$ cd ../feature-auth
$ gf ship --message "Add JWT authentication"
✓ Committed changes
✓ Pushed to origin/feature-auth
✓ Switched to main
✓ Fast-forward merged feature-auth
✓ Removed worktree
✓ Cleaned up resources
```

---

### `gf list`

**Purpose:** Display all active worktrees managed by GitterFlow.

**Behavior:**
1. Read all metadata files from `.gitterflow/worktrees/`
2. Check git worktree status for each
3. Display formatted table

**Output:**
```
BRANCH              BASE     PORT   STATUS        CREATED
feature-auth        main     3001   active        2h ago
bugfix-login        main     3002   active        30m ago
refactor-db         develop  3003   detached      1d ago
```

**Status values:**
- `active`: Worktree exists, tmux session running
- `detached`: Worktree exists, no active session
- `stale`: Metadata exists but worktree removed

**Options:**
- `--json`: Output machine-readable JSON array

---

### `gf cleanup <branch-name>`

**Purpose:** Manually remove a worktree and its resources.

**Behavior:**
1. Kill tmux session if running
2. Remove Git worktree
3. Delete metadata file
4. Optionally delete remote branch

**Options:**
- `--remote`: Also delete remote branch
- `--force`: Skip confirmation prompts

---

### `gf help`

**Purpose:** Display help information for all commands.

**Behavior:**
- With no arguments: Show command list and usage
- With command name: Show detailed help for that command

**Examples:**
```bash
$ gf help
$ gf help create
```

---

### `gf version`

**Purpose:** Print version and runtime information.

**Output:**
```
gitterflow v0.1.0
Runtime: Bun 1.3.0
Platform: darwin-arm64
```

## Configuration Model

### Configuration File: `.gitterflow.yaml`

**Location:** Repository root (`.gitterflow.yaml` or `.gitterflow.json`)

**Default Configuration:**
```yaml
# Launch mode: "headless" (tmux) or "window" (new editor window)
mode: headless

# AI editor command: "cursor", "code", "cursor-code", "claude-code"
editor: cursor

# Base port for dev servers (auto-increments for each worktree)
basePort: 3000

# Command to start dev server (runs in pane 1)
devCommand: "bun --hot src/index.ts"

# Base branch to merge back into (auto-detected if not set)
baseBranch: main

# Optional: Custom worktree directory template
# Default: ../<branch-name>
worktreePath: "../{branch}"

# Optional: tmux layout ("even-horizontal", "even-vertical", "main-horizontal")
tmuxLayout: main-horizontal
```

**Environment Variable Support:**
- `${VAR}` interpolation supported in commands
- Example: `devCommand: "PORT=${GF_PORT} bun run dev"`

### Auto-injected Environment Variables

When launching terminals, GitterFlow auto-injects:
- `GF_BRANCH`: Current worktree branch name
- `GF_BASE_BRANCH`: Base branch to merge into
- `GF_PORT`: Assigned port number
- `GF_WORKTREE_PATH`: Absolute path to worktree

## Project Structure

```
GitterFlow/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── create.ts         # gf create
│   │   ├── ship.ts           # gf ship
│   │   ├── list.ts           # gf list
│   │   ├── cleanup.ts        # gf cleanup
│   │   ├── help.ts           # gf help
│   │   └── version.ts        # gf version
│   ├── config/
│   │   ├── loader.ts         # Load and parse .gitterflow.yaml
│   │   ├── schema.ts         # Config validation schema
│   │   └── defaults.ts       # Default config values
│   ├── utils/
│   │   ├── git.ts            # Git operations wrapper
│   │   ├── tmux.ts           # tmux session management
│   │   ├── ports.ts          # Port allocation logic
│   │   └── metadata.ts       # Worktree metadata CRUD
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── tests/
│   ├── commands/
│   │   ├── create.test.ts
│   │   └── ship.test.ts
│   └── fixtures/
│       └── test-repo/
├── .gitterflow.yaml          # Example config
├── package.json
├── tsconfig.json
└── README.md
```

## Technical Architecture

### Runtime & Dependencies
- **Runtime:** Bun 1.3+
- **Argument Parser:** Minimal custom parser (avoid dependencies for fast startup)
- **Config Parser:** Built-in YAML support via Bun or lightweight library
- **Terminal Multiplexer:** tmux (must be installed for headless mode)
- **Git:** System git command (wrapped in `utils/git.ts`)

### Port Management Strategy
1. Read `basePort` from config (default: 3000)
2. Scan existing worktree metadata for used ports
3. Allocate next available port: `basePort + n`
4. Store in metadata for cleanup and `gf list` display

### tmux Integration

**Session Naming:** `gf-<branch-name>`

**Layout Creation:**
```typescript
// Pseudo-code for tmux setup
async function createTmuxSession(branch: string, config: Config) {
  const session = `gf-${branch}`;

  // Create new detached session
  await $`tmux new-session -d -s ${session} -c ${worktreePath}`;

  // Split into 3 panes
  await $`tmux split-window -h -t ${session}`;
  await $`tmux split-window -v -t ${session}:0.1`;

  // Send commands to panes
  await $`tmux send-keys -t ${session}:0.0 "${config.devCommand}" C-m`;
  await $`tmux send-keys -t ${session}:0.1 "${config.editor} ." C-m`;
  await $`tmux send-keys -t ${session}:0.2 "# Manual terminal ready" C-m`;

  // Attach to session
  await $`tmux attach -t ${session}`;
}
```

### Fast-Forward Merge Strategy

**Why fast-forward only?**
- Keeps linear history
- Forces developers to sync before shipping
- Prevents accidental merge commits
- Fails safely if base branch has diverged

**Sync workflow (future):**
```bash
$ gf sync  # Fetch base branch and rebase current work
```

### Metadata Storage

**Location:** `.gitterflow/worktrees/<branch>.json`

**Purpose:**
- Track which worktree belongs to which base branch
- Store allocated port numbers
- Record tmux session names for cleanup
- Enable `gf list` to show full status

**Add to `.gitignore`:**
```
.gitterflow/
```

## Non-Functional Requirements

### Performance
- CLI startup: < 50ms
- Worktree creation: < 2 seconds (excluding git operations)
- Port allocation: < 10ms
- Metadata read/write: < 5ms

### Compatibility
- **macOS:** Primary target (tmux widely available)
- **Linux:** Full support
- **Windows/WSL:** Best-effort support (tmux available in WSL)

### Error Handling
- Clear error messages with suggested fixes
- Non-zero exit codes for script integration
- Graceful degradation (e.g., if tmux not installed, suggest window mode)

## Testing Strategy

### Unit Tests (Bun test)
- Command argument parsing
- Port allocation logic
- Metadata CRUD operations
- Config loading and validation

### Integration Tests
- Full `gf create` → work → `gf ship` workflow
- tmux session lifecycle
- Git operations (using test fixtures)

### Manual Testing Scenarios
1. Create 3 worktrees simultaneously, verify ports auto-increment
2. Ship worktree while base branch has diverged (should fail)
3. Kill tmux session manually, run `gf cleanup` (should handle gracefully)
4. Run `gf create` without tmux installed (should suggest alternatives)

## Implementation Roadmap

### Phase 0: Foundation (Week 1)
- [x] Basic CLI structure with help command
- [ ] Config loader for `.gitterflow.yaml`
- [ ] Metadata storage system
- [ ] Port allocation utility

### Phase 1: Core Commands (Week 2)
- [ ] `gf create` - basic worktree creation
- [ ] `gf create` - tmux integration
- [ ] `gf list` - display worktrees
- [ ] `gf cleanup` - manual cleanup

### Phase 2: Shipping Workflow (Week 3)
- [ ] `gf ship` - commit and push
- [ ] `gf ship` - fast-forward merge
- [ ] `gf ship` - automatic cleanup
- [ ] Error handling and validation

### Phase 3: Polish & Testing (Week 4)
- [ ] Comprehensive test suite
- [ ] Documentation and examples
- [ ] Window mode support
- [ ] Package for distribution

### Future Enhancements
- `gf sync` - sync base branch into worktree
- `gf switch` - attach to existing worktree session
- `gf init` - interactive config setup
- Shell completion scripts
- GitHub/GitLab integration for PR creation

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| tmux not installed | Cannot use headless mode | Detect at runtime, suggest install or window mode |
| Port conflicts | Dev server fails to start | Check port availability before allocation |
| Fast-forward merge fails | Can't ship changes | Clear error message, suggest `git rebase` workflow |
| Stale metadata | `gf list` shows incorrect status | Add validation and auto-cleanup of stale entries |
| Bun compatibility | Users on older versions | Document minimum Bun version, check at startup |

## Success Metrics

### MVP Success Criteria
- [ ] Can create 3+ parallel worktrees in < 10 seconds
- [ ] Ship workflow completes in < 5 seconds (excluding git operations)
- [ ] Zero data loss or corrupt git state in testing
- [ ] Works on macOS and Linux without installation issues

### User Experience Goals
- 90% of users should understand core commands without reading docs
- Average workflow (create → work → ship) should feel faster than manual git operations
- Error messages should be actionable (tell user what to do next)

## References
- Git worktree docs: https://git-scm.com/docs/git-worktree
- tmux manual: https://man.openbsd.org/tmux
- Bun CLI: https://bun.sh/docs/cli/run
- Similar tools: `git-workspace`, `git-town`, `worktree` GitHub Action
