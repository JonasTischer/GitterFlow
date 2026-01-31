# GitterFlow CLI

> **Orchestrate Claude Code agents with Git worktrees**

GitterFlow (`gf`) is a CLI utility that enables orchestration of AI coding agents using Git worktrees for isolation. Run multiple Claude Code instances in parallel, each working on independent tasks in their own worktree.

## Vision

GitterFlow evolves in two phases:

### Phase 1: Human Developer Tools ✅
Give developers ergonomic tools to manage parallel AI coding workflows:
- Create worktrees with one command
- Auto-open terminal/IDE with your coding agent
- AI-generated commit messages
- Smart merge workflows

### Phase 2: Agent Orchestration 🚧
Enable Claude Code agents to spawn and coordinate sub-agents autonomously:
- Brain agent spawns sub-agents for parallel tasks
- Sub-agents work independently in isolated worktrees
- Automatic merge back when complete
- Status tracking and notifications

```
┌─────────────────────────────────────────────────────────────┐
│                    BRAIN AGENT (Orchestrator)                │
│                                                              │
│  gf new --task "Add feature X" --autonomous                 │
│  gf new --task "Fix bug Y" --autonomous                     │
│  gf status                                                   │
└─────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│   SUB-AGENT 1   │  │   SUB-AGENT 2   │
│   Worktree A    │  │   Worktree B    │
│   Feature X     │  │   Bug Fix Y     │
│   → gf finish   │  │   → gf finish   │
└─────────────────┘  └─────────────────┘
```

## Quick Start

### Installation

```bash
# Install dependencies
bun install

# Link CLI globally
bun link
```

### Usage

```bash
# Initialize configuration (interactive setup wizard)
gf init

# Create a new worktree (opens terminal/IDE automatically)
gf new [branch-name]

# Create worktree with initial task for Claude Code
gf new --task "Implement user authentication"

# Create worktree for autonomous agent (auto-merges when done)
gf new --task "Add retry logic" --autonomous

# Check status of autonomous agents
gf status

# List active worktrees (interactive selector)
gf list

# Delete a worktree
gf delete [branch-name]

# Commit with AI-generated message
gf snap

# Merge branch back and clean up
gf finish
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Auto-open terminal/IDE** | New worktrees open with your coding agent ready |
| **`--task` flag** | Pass initial prompt to Claude Code |
| **Pre-trust worktrees** | No "trust this folder?" dialogs |
| **AI commits** | Generate commit messages with OpenRouter |
| **Smart merge** | Detects base branch, handles conflicts |

### Configuration

Run `gitterflow init` to interactively set up your configuration, or manually create `.gitterflow.yaml`:

```yaml
base_branch: main
worktrees_dir: ../worktrees
ai_model: google/gemini-3-flash-preview
open_terminal: true
delete_remote_on_finish: false
coding_agent: claude
terminal: iterm
ide: cursor  # Optional: cursor, code, or custom IDE name
```

**Configuring Terminal:**

You can configure which terminal to use in three ways:

1. **Environment variable** (highest priority):
   ```bash
   export GITTERFLOW_TERMINAL=iterm  # or GF_TERMINAL=iterm
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   terminal: iterm  # Options: terminal, iterm (macOS) | gnome-terminal (Linux) | windows-terminal (Windows)
   ```

3. **Auto-detection** (fallback):
   - macOS: Detects iTerm2 if `TERM_PROGRAM=iTerm.app`, otherwise uses Terminal.app
   - Linux: Uses GNOME Terminal
   - Windows: Uses Windows Terminal

**Supported terminals:**
- **macOS**: `terminal` (Terminal.app), `iterm` (iTerm2)
- **Linux**: `gnome-terminal`
- **Windows**: `windows-terminal` (Windows Terminal), `cmd` (Command Prompt)

**Configuring IDE:**

You can configure an IDE to open instead of (or alongside) a terminal:

1. **Config file** (`.gitterflow.yaml`):
   ```yaml
   ide: cursor  # Options: cursor, code, vscode, or custom IDE name
   open_terminal: true  # Can open both IDE and terminal
   ```

2. **Supported IDEs:**
   - **Cursor**: Opens Cursor with integrated terminal
   - **VS Code**: Opens Visual Studio Code with integrated terminal
   - **Custom**: Any IDE name/command that can be launched from CLI

When an IDE is configured, it will open with an integrated terminal running your coding agent. You can also configure both IDE and terminal to open simultaneously.

**Configuring Coding Agent:**

The command automatically runs a coding agent in the new terminal/IDE. Configure it via:

1. **Environment variable**:
   ```bash
   export GITTERFLOW_AGENT=codex  # or GF_AGENT, GITTERFLOW_CODING_AGENT, GF_CODING_AGENT
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   coding_agent: codex  # or "claude", "cursor", or any custom command
   ```

3. **Default**: `claude` (if not configured)

The terminal/IDE will automatically navigate to the worktree directory and run your configured coding agent command.

If terminal/IDE spawning fails or is unavailable, the command outputs the `cd` and agent commands you can run manually.

**Configuring OpenRouter Model (for `snap` command):**

The `snap` command uses OpenRouter API to generate commit messages. Configure the model via:

1. **Environment variable**:
   ```bash
   export GITTERFLOW_MODEL=google/gemini-3-flash-preview  # or GF_MODEL, GITTERFLOW_OPENROUTER_MODEL, GF_OPENROUTER_MODEL
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   ai_model: google/gemini-3-flash-preview  # or "anthropic/claude-3.5-sonnet" or any OpenRouter model
   ```

3. **Default**: `google/gemini-3-flash-preview` (if not configured)

**Note:** You need to set `OPENROUTER_API_KEY` environment variable to use the `snap` command.

**Commit Message Confirmation:**

When using `snap`, you'll see an interactive prompt:
- Press **y** → Commit with the generated message (no Enter needed)
- Press **e** → Edit the commit message before committing
- Press **n** → Cancel the commit

## Commands Reference

### `gitterflow init`

Interactive setup wizard that creates `.gitterflow.yaml` configuration file.

- Checks if config already exists and asks to overwrite
- Prompts for base branch, worktrees directory, AI model, terminal/IDE preferences
- Optionally creates shell alias (e.g., `gf` for `gitterflow`)

### `gitterflow new [branch-name] [--task <prompt>]`

Creates a new git worktree with an optional branch name. If no branch name is provided, generates a random name.

- Creates worktree in parent directory (e.g., `../branch-name`)
- Pre-trusts the worktree in Claude Code (no trust dialog)
- Opens terminal/IDE in the worktree directory
- Runs configured coding agent automatically

**Options:**
- `--task <prompt>` or `-t <prompt>` - Pass initial prompt to Claude Code
  ```bash
  gf new --task "Implement shell completions for bash/zsh/fish"
  gf new feature-auth --task "Add OAuth2 authentication"
  ```
- `--autonomous` or `-a` - Run agent autonomously, auto-merge when done
- `--headless` or `-H` - Skip terminal/IDE spawning, output JSON (for CI/pipelines/orchestrators)
  ```bash
  # Returns JSON with worktree info - perfect for automation
  gf new --task "Add feature" --autonomous --headless
  # Output: {"success":true,"branch":"worktree-calm-fox-123","worktree":"/path/to/worktree",...}
  ```
- `--spawn` or `-s` - Spawn `claude -p` in background (implies --headless --autonomous)
  ```bash
  # Spawns Claude Code CLI headlessly and returns immediately
  gf new --spawn --task "Implement auth module"
  # Agent runs in background - use `gf status` to monitor
  ```
- `--parent <branch>` - Track parent branch for recursive sub-agent spawning
- `--allowed-tools <tools>` - Comma-separated tools to pre-approve for spawn mode

### `gitterflow list`

Lists all active worktrees with an interactive selector.

- Shows all worktrees with branch names and paths
- Navigate with arrow keys, select with Enter
- Opens terminal/IDE in the selected worktree

### `gitterflow delete <branch-name>`

Removes a worktree for the specified branch.

- Deletes the worktree directory
- Removes the git worktree reference

### `gitterflow snap [--no-confirm] [-m <message>]`

Automatically commits staged or modified changes with an AI-generated commit message.

- Stages all changes (`git add -A`)
- Generates commit message using OpenRouter API (or use `-m` to provide your own)
- Interactive confirmation: **y** (yes), **e** (edit), **n** (cancel)
- Runs git hooks normally (no `--no-verify`)

**Options:**
- `--no-confirm` - Skip confirmation prompt, commit immediately with AI message
- `-m <message>` or `--message <message>` - Use custom commit message (skips AI generation)

**Pre-commit Hook Handling:**

`snap` intelligently handles pre-commit hooks that modify files (e.g., formatters like Prettier, ESLint --fix):

1. If the hook **modifies files** (formatter runs), `snap` automatically stages those changes and amends the commit
2. If the hook **fails** (lint errors, etc.), `snap` shows a helpful message and your changes remain staged — just fix the issues and run `gf snap` again

### `gitterflow finish`

Completes work on a feature branch by merging it into the base branch.

- Commits any uncommitted changes (using AI-generated message)
- Auto-stashes uncommitted changes in base branch if needed
- Checks out base branch and pulls latest changes
- Merges feature branch into base branch
- Auto-pops stashed changes after merge
- Optionally deletes local/remote branches and removes worktree
- Updates agent state if running autonomously
- Aborts if already on base branch

### `gitterflow status`

Shows status of all autonomous agents.

```
AUTONOMOUS AGENTS
─────────────────────────────────────────────────────────────────────
Branch                    Status       Task                      Started
─────────────────────────────────────────────────────────────────────
worktree-happy-fox-123    running      Add retry logic...        2 min ago
worktree-calm-tiger-456   merged       Fix auth bug...           5 min ago
─────────────────────────────────────────────────────────────────────
```

- Shows all agents spawned with `--autonomous` flag
- Status can be: `running`, `completed`, `merged`, `failed`, `conflict`
- Displays task summary and start time

## Development

## Setting Up Development Environment

```bash
# Install dependencies
bun install

# Link CLI globally for testing
bun link
```

Install lefthook for git hooks:

```bash
bun prepare
```


This project follows **Test-Driven Development (TDD)** practices.

### Running Tests

```bash
# Run unit tests only (fast - for development)
bun test
# or
bun run test:unit

# Run integration tests only (slower - real git operations)
bun run test:integration

# Run all tests (unit + integration)
bun run test:all

# Run tests in watch mode (unit tests only)
bun run test:watch

# Run tests with coverage report
bun run test:coverage

# Run specific test file
bun test tests/commands/start.test.ts
bun test tests/integration/start.integration.test.ts
```

**Test Types:**
- **Unit Tests** (`tests/commands/*.test.ts`, `tests/cli.test.ts`)
  - Fast (milliseconds)
  - Mock git commands
  - Test business logic in isolation
  - Run on every save during development

- **Integration Tests** (`tests/integration/*.integration.test.ts`)
  - Slower (seconds)
  - Execute real git commands
  - Create temporary repositories
  - Verify end-to-end workflows
  - Run before commits and in CI

### TDD Workflow

1. **Write the test FIRST** - Before implementing any feature
2. **Run the test** - Verify it fails for the right reason
3. **Write minimal code** - Just enough to make the test pass
4. **Run tests again** - Verify the test now passes
5. **Refactor** - Clean up while keeping tests green
6. **Repeat** - Continue the cycle

See [CLAUDE.md](./CLAUDE.md) for detailed TDD guidelines and testing patterns.

### Code Coverage

- Minimum coverage: **80%** (enforced in CI)
- Coverage reports: `coverage/` directory
- View coverage: Open `coverage/lcov-report/index.html`

### Project Structure

```
GitterFlow/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── cli.ts                # Command dispatcher
│   ├── config.ts             # Configuration loader
│   ├── commands/             # Command implementations
│   │   ├── new.ts            # Worktree creation + --task flag
│   │   ├── finish.ts         # Merge workflow
│   │   ├── snap.ts           # AI commits
│   │   ├── list.ts           # List worktrees
│   │   ├── delete.ts         # Remove worktrees
│   │   ├── init.ts           # Setup wizard
│   │   └── help.ts           # Help command
│   └── utils/
│       ├── terminal.ts       # Terminal spawning (macOS/Linux/Windows)
│       ├── ide.ts            # IDE opening (Cursor/VS Code)
│       ├── claude-trust.ts   # Pre-trust worktrees in Claude Code
│       ├── symlink.ts        # Symlink creation
│       └── scanner.ts        # Symlink candidate detection
├── tests/
│   ├── unit/                 # Fast unit tests (mocked)
│   └── integration/          # Real git operations
├── docs/
│   └── ARCHITECTURE.md       # Technical architecture & Phase 2 design
└── .gitterflow.yaml          # Project configuration
```

## CI/CD

GitHub Actions automatically:
- Runs tests on push and PR
- Enforces 80% code coverage
- Tests on Ubuntu and macOS
- Uploads coverage reports to Codecov

## Documentation

- [CLI Specification](./gitterflow-cli-spec.md) - Detailed command reference and architecture
- [Development Guide](./CLAUDE.md) - TDD practices and Bun-specific guidance

## Roadmap

### Phase 1: Human Developer Tools ✅
- [x] `gf init` - Interactive configuration setup
- [x] `gf new` - Worktree creation with terminal/IDE support
- [x] `gf new --task` - Pass initial prompt to Claude Code
- [x] `gf list` - Interactive worktree listing
- [x] `gf delete` - Worktree removal
- [x] `gf snap` - AI-generated commit messages
- [x] `gf finish` - Merge workflow and cleanup
- [x] Pre-trust worktrees in Claude Code config
- [x] IDE support (Cursor, VS Code)
- [x] Shell alias creation

### Phase 2: Agent Orchestration 🚧
- [x] `--autonomous` flag - Sub-agents auto-finish when done
- [x] `gf status` - Check status of running agents
- [x] Agent state tracking in `.gitterflow/agents/`
- [x] GitterFlow skill for Claude Code (`.claude/skills/gitterflow/SKILL.md`)
- [ ] `gf mark-failed` - Mark failed agents
- [ ] `gf notify-complete` - Hook integration for notifications
- [ ] Hooks setup in `gf init`

### Phase 3: Advanced Features
- [ ] `--pr` flag - Create PR instead of direct merge
- [ ] `gf cancel` - Kill running autonomous agents
- [ ] Shell completion scripts
- [ ] Port allocation for multi-service worktrees

## Requirements

- [Bun](https://bun.sh) 1.3+
- Git 2.0+
- `OPENROUTER_API_KEY` environment variable (for `snap` command)

## License

MIT

---

Built with ❤️ using [Bun](https://bun.sh)
