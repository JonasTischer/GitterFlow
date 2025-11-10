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
# Show help
gitterflow help

# Create a new worktree (with optional branch name)
# Automatically opens a new terminal window/tab in the worktree directory
gitterflow new [branch-name]

# List active worktrees
gitterflow list

# Delete a worktree
gitterflow delete [branch-name]

# Automatically commit changes with AI-generated commit message
gitterflow snap [--no-confirm]
```

**Note:** The `new` command automatically opens a new terminal window/tab in the created worktree directory.

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

**Configuring Coding Agent:**

The command automatically runs a coding agent in the new terminal. Configure it via:

1. **Environment variable**:
   ```bash
   export GITTERFLOW_AGENT=codex  # or GF_AGENT, GITTERFLOW_CODING_AGENT, GF_CODING_AGENT
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   codingAgent: codex  # or "claude", "cursor", or any custom command
   ```

3. **Default**: `claude` (if not configured)

The terminal will automatically navigate to the worktree directory and run your configured coding agent command.

If terminal spawning fails or is unavailable, the command outputs the `cd` and agent commands you can run manually.

**Configuring OpenRouter Model (for `snap` command):**

The `snap` command uses OpenRouter API to generate commit messages. Configure the model via:

1. **Environment variable**:
   ```bash
   export GITTERFLOW_MODEL=qwen/qwen3-235b-a22b-2507  # or GF_MODEL, GITTERFLOW_OPENROUTER_MODEL, GF_OPENROUTER_MODEL
   ```

2. **Config file** (`.gitterflow.yaml`):
   ```yaml
   openRouterModel: qwen/qwen3-235b-a22b-2507  # or "anthropic/claude-3.5-sonnet" or any OpenRouter model
   ```

3. **Default**: `anthropic/claude-3.5-sonnet` (if not configured)

**Note:** You need to set `OPENROUTER_API_KEY` environment variable to use the `snap` command.

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
│   └── commands/             # Command implementations and types
│       ├── delete.ts
│       ├── help.ts
│       ├── index.ts
│       ├── list.ts
│       ├── start.ts
│       └── types.ts
├── tests/
│   └── cli.test.ts           # CLI and command contract tests
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
- [ ] Config loader for `.gitterflow.yaml`
- [ ] Metadata storage system
- [ ] Port allocation utility

### Phase 1: Core Commands (In Progress)
- [ ] `gf create` - Worktree creation + tmux setup
- [ ] `gf ship` - Commit, push, merge workflow
- [ ] `gf list` - Display worktrees
- [ ] `gf cleanup` - Manual cleanup

### Phase 2: Shipping Workflow
- [ ] Fast-forward merge validation
- [ ] Automatic cleanup after ship
- [ ] Error handling and recovery

### Phase 3: Polish
- [ ] Comprehensive test coverage
- [ ] Window mode support
- [ ] Shell completion scripts

## Requirements

- [Bun](https://bun.sh) 1.3+
- Git 2.0+
- tmux (for headless mode)

## License

MIT

---

Built with ❤️ using [Bun](https://bun.sh)
