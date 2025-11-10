# GitterFlow CLI

> A fast, ergonomic CLI for managing parallel AI coding workflows with Git worktrees

GitterFlow (`gf`) enables developers to run multiple AI coding agents in parallel using Git worktrees. Each worktree provides an isolated environment where an agent (like Claude Code or Cursor) can work on a specific feature independently.

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
gitterflow init

# Create a new worktree (with optional branch name)
# Automatically opens terminal/IDE in the worktree directory
gitterflow new [branch-name]

# List active worktrees (interactive selector)
gitterflow list

# Delete a worktree
gitterflow delete [branch-name]

# Automatically commit changes with AI-generated commit message
gitterflow snap [--no-confirm]

# Finish work: merge branch, push, and clean up
gitterflow finish
```

**Note:** The `new` command automatically opens a new terminal window/tab or IDE in the created worktree directory (configurable).

### Configuration

Run `gitterflow init` to interactively set up your configuration, or manually create `.gitterflow.yaml`:

```yaml
base_branch: main
worktrees_dir: ../worktrees
ai_model: qwen/qwen3-235b-a22b-2507
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
   export GITTERFLOW_MODEL=qwen/qwen3-235b-a22b-2507  # or GF_MODEL, GITTERFLOW_OPENROUTER_MODEL, GF_OPENROUTER_MODEL
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   ai_model: qwen/qwen3-235b-a22b-2507  # or "anthropic/claude-3.5-sonnet" or any OpenRouter model
   ```

3. **Default**: `qwen/qwen3-235b-a22b-2507` (if not configured)

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

### `gitterflow new [branch-name]`

Creates a new git worktree with an optional branch name. If no branch name is provided, generates a random name.

- Creates worktree in parent directory (e.g., `../branch-name`)
- Opens terminal/IDE in the worktree directory
- Runs configured coding agent automatically

### `gitterflow list`

Lists all active worktrees with an interactive selector.

- Shows all worktrees with branch names and paths
- Navigate with arrow keys, select with Enter
- Opens terminal/IDE in the selected worktree

### `gitterflow delete <branch-name>`

Removes a worktree for the specified branch.

- Deletes the worktree directory
- Removes the git worktree reference

### `gitterflow snap [--no-confirm]`

Automatically commits staged or modified changes with an AI-generated commit message.

- Stages all changes (`git add -A`)
- Generates commit message using OpenRouter API
- Interactive confirmation: **y** (yes), **e** (edit), **n** (cancel)
- Commits with `--no-verify` flag

### `gitterflow finish`

Completes work on a feature branch by merging it into the base branch.

- Commits any uncommitted changes (using `snap` logic)
- Checks out base branch and pulls latest changes
- Merges feature branch into base branch
- Pushes updated base branch to origin
- Optionally deletes local/remote branches and removes worktree
- Aborts if already on base branch

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
bun run test
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
│   ├── index.ts              # CLI entry point (shebang)
│   ├── cli.ts                # Command dispatcher and shared CLI wiring
│   ├── config.ts             # Configuration loader
│   ├── commands/             # Command implementations
│   │   ├── delete.ts
│   │   ├── finish.ts
│   │   ├── help.ts
│   │   ├── init.ts
│   │   ├── list.ts
│   │   ├── new.ts
│   │   ├── snap.ts
│   │   ├── index.ts
│   │   └── types.ts
│   └── utils/                # Shared utilities
│       ├── terminal.ts       # Terminal spawning
│       └── ide.ts            # IDE opening
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── .github/workflows/        # CI/CD workflows
├── bunfig.toml              # Bun configuration
└── gitterflow-cli-spec.md   # Detailed specification
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

### Phase 0: Foundation ✅
- [x] Basic CLI structure with help command
- [x] Test setup with TDD workflow
- [x] CI/CD pipeline
- [x] Config loader for `.gitterflow.yaml`
- [ ] Metadata storage system
- [ ] Port allocation utility

### Phase 1: Core Commands ✅
- [x] `gitterflow init` - Interactive configuration setup
- [x] `gitterflow new` - Worktree creation with terminal/IDE support
- [x] `gitterflow list` - Interactive worktree listing
- [x] `gitterflow delete` - Worktree removal
- [x] `gitterflow snap` - AI-generated commit messages
- [x] `gitterflow finish` - Merge workflow and cleanup

### Phase 2: Enhancements
- [x] IDE support (Cursor, VS Code)
- [x] Interactive commit message editing
- [x] Shell alias creation
- [ ] Fast-forward merge validation
- [ ] Error handling and recovery improvements

### Phase 3: Polish
- [x] Comprehensive test coverage
- [ ] Window mode support
- [ ] Shell completion scripts

## Requirements

- [Bun](https://bun.sh) 1.3+
- Git 2.0+
- `OPENROUTER_API_KEY` environment variable (for `snap` command)

## License

MIT

---

Built with ❤️ using [Bun](https://bun.sh)
