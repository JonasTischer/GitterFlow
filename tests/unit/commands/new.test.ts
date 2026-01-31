import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { newCommand } from "../../../src/commands/new";
import { readAgentState } from "../../../src/utils/agent-state";
import { captureExec, commandIO } from "../test-helpers";

describe("new command", () => {
	describe("random branch name generation", () => {
		test("should generate random branch name when none provided", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: [],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages).toHaveLength(4);
			expect(stdoutMessages[0]).toContain("Created worktree");
			expect(stdoutMessages[1]).toContain("Switched to");
			expect(stdoutMessages[2]).toContain("cd ");
			expect(stdoutMessages[3]).toContain("claude");

			// Should have made 4 git calls: status, rev-parse, worktree add, config
			expect(calls).toHaveLength(4);
			expect(calls[2]?.strings.join("")).toContain("git worktree add");
			expect(calls[2]?.values).toHaveLength(2); // branch name and path
		});

		test("should use empty string args as no branch name", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: [""],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages).toHaveLength(4);
			// Should have made 4 git calls: status, rev-parse, worktree add, config
			expect(calls).toHaveLength(4);
		});

		test("should use whitespace-only args as no branch name", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: ["   "],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages).toHaveLength(4);
			// Should have made 4 git calls: status, rev-parse, worktree add, config
			expect(calls).toHaveLength(4);
		});

		test("should generate different names on multiple calls", async () => {
			const names = new Set<string>();

			for (let i = 0; i < 5; i++) {
				const { exec, calls } = captureExec();
				const { io } = commandIO();

				await newCommand.run({
					args: [],
					exec,
					...io,
				});

				// Third call is the git worktree add command (after status and rev-parse)
				const branchName = calls[2]?.values[0] as string;
				names.add(branchName);
			}

			// Should have generated at least 4 different names out of 5
			// (extremely unlikely to get duplicates with good random generation)
			expect(names.size).toBeGreaterThanOrEqual(4);
		});
	});

	describe("git worktree creation", () => {
		test("should create new branch and worktree when branch doesn't exist", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages, stderrMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: ["feature/new-feature"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);
			expect(stdoutMessages).toHaveLength(4);
			expect(stdoutMessages[0]).toContain(
				"Created worktree for branch feature/new-feature",
			);
			expect(stdoutMessages[1]).toContain("Switched to");
			expect(stdoutMessages[2]).toContain("cd ");
			expect(stdoutMessages[3]).toContain("claude");

			// Should have made 4 git calls: status, rev-parse, worktree add, config
			expect(calls).toHaveLength(4);
			expect(calls[2]?.strings.join("")).toContain("git worktree add");
			expect(calls[2]?.strings.join("")).toContain("-b");
			expect(calls[2]?.values).toContain("feature/new-feature");
		});

		test("should use correct worktree path in parent directory", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["my-branch"],
				exec,
				...io,
			});

			// Path should be ../my-branch (third call is git worktree add, after status and rev-parse)
			const commandStr = calls[2]?.strings.join("{{VALUE}}") ?? "";
			const fullCommand = calls[2]?.values.reduce(
				(cmd: string, val: unknown, _idx: number) =>
					cmd.replace("{{VALUE}}", String(val)),
				commandStr,
			);

			expect(fullCommand).toContain("../my-branch");
		});

		test("should handle branch names with slashes (feature/foo)", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature/authentication"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("feature/authentication");
			expect(stdoutMessages[1]).toContain("Switched to");
			expect(stdoutMessages[2]).toContain("cd ");
			expect(stdoutMessages[3]).toContain("claude");
			// Third call is git worktree add (after status and rev-parse)
			expect(calls[2]?.values).toContain("feature/authentication");
		});

		test("should handle branch names with hyphens", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["fix-bug-123"],
				exec,
				...io,
			});

			// Third call is git worktree add (after status and rev-parse)
			expect(calls[2]?.values).toContain("fix-bug-123");
		});
	});

	describe("error handling", () => {
		// Helper to create an exec that succeeds for status but fails for other commands
		const createFailingExec = (
			errorMessage: string,
			shellError?: { exitCode?: number; stderr?: string },
		) => {
			return async (strings: TemplateStringsArray) => {
				const command = strings.join("");

				// First call is git status - return empty (no uncommitted changes)
				if (command.includes("git status --porcelain")) {
					return {
						text: async () => "",
					};
				}

				// All other calls fail
				const error = new Error(errorMessage);
				if (shellError?.exitCode) {
					(error as unknown as { exitCode: number }).exitCode =
						shellError.exitCode;
				}
				if (shellError?.stderr) {
					(error as unknown as { stderr: string }).stderr = shellError.stderr;
				}
				throw error;
			};
		};

		test("should return error code when git command fails", async () => {
			const { io, stderrMessages } = commandIO();
			const failingExec = createFailingExec("git worktree add failed");

			const exitCode = await newCommand.run({
				args: ["test-branch"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages).toHaveLength(1);
			expect(stderrMessages[0]).toContain("Failed to create worktree");
		});

		test("should handle ShellError with exit code", async () => {
			const { io, stderrMessages } = commandIO();
			const failingExec = createFailingExec("fatal: invalid reference: test", {
				exitCode: 128,
				stderr: "fatal: invalid reference: test\n",
			});

			const exitCode = await newCommand.run({
				args: ["test-branch"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Failed to create worktree");
		});

		test("should show helpful error message on git failure", async () => {
			const { io, stderrMessages } = commandIO();
			const failingExec = createFailingExec(
				"worktree '../test' already exists",
			);

			await newCommand.run({
				args: ["test"],
				exec: failingExec,
				...io,
			});

			expect(stderrMessages[0]).toMatch(
				/Failed to create worktree|already exists/i,
			);
		});
	});

	describe("integration behavior", () => {
		test("should create worktree from current branch as base", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-x"],
				exec,
				...io,
			});

			// The worktree should be created from HEAD (current branch)
			// git worktree add -b feature-x ../feature-x
			expect(calls).toHaveLength(4);
			// Third call is git worktree add (after status and rev-parse)
			const cmd = calls[2]?.strings.join("").trim() ?? "";
			expect(cmd).toContain("git worktree add");
			expect(cmd).toContain("-b");
		});

		test("should ignore extra arguments beyond branch name", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["my-branch", "extra", "args"],
				exec,
				...io,
			});

			// Should only use first argument as branch name
			expect(stdoutMessages[0]).toContain("my-branch");
			expect(stdoutMessages[0]).not.toContain("extra");
			expect(stdoutMessages[1]).toContain("Switched to");
			expect(stdoutMessages[2]).toContain("cd ");
			expect(stdoutMessages[3]).toContain("claude");
			// Third call is git worktree add (after status and rev-parse)
			expect(calls[2]?.values).toContain("my-branch");
		});
	});

	describe("success messages", () => {
		test("should output success message with branch name", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature/awesome"],
				exec,
				...io,
			});

			expect(stdoutMessages).toHaveLength(4);
			expect(stdoutMessages[0]).toContain("Created worktree");
			expect(stdoutMessages[0]).toContain("feature/awesome");
			expect(stdoutMessages[1]).toContain("Switched to");
			expect(stdoutMessages[2]).toContain("cd ");
			expect(stdoutMessages[3]).toContain("claude");
		});

		test("should use checkmark emoji in success message", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["test"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("✅");
			expect(stdoutMessages[1]).toContain("📁");
			expect(stdoutMessages[2]).toContain("cd ");
		});
	});

	describe("--task flag", () => {
		test("should pass task to coding agent when --task flag is provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-x", "--task", "Implement shell completions"],
				exec,
				...io,
			});

			expect(stdoutMessages).toHaveLength(4);
			// The agent command output should include the task
			expect(stdoutMessages[3]).toContain("claude");
			expect(stdoutMessages[3]).toContain("Implement shell completions");
		});

		test("should work with --task flag before branch name", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["--task", "Fix the bug", "fix-branch"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("fix-branch");
			expect(stdoutMessages[3]).toContain("Fix the bug");
		});

		test("should generate random branch name when only --task is provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["--task", "Add new feature"],
				exec,
				...io,
			});

			// Should have created worktree with random name
			expect(stdoutMessages[0]).toContain(
				"Created worktree for branch worktree-",
			);
			expect(stdoutMessages[3]).toContain("Add new feature");
		});

		test("should handle task with special characters", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["test-branch", "--task", "Fix bug #123 & add tests"],
				exec,
				...io,
			});

			expect(stdoutMessages[3]).toContain("Fix bug #123 & add tests");
		});

		test("should handle multi-word task without quotes in args array", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["branch", "--task", "This is a long task description"],
				exec,
				...io,
			});

			expect(stdoutMessages[3]).toContain("This is a long task description");
		});
	});

	describe("--autonomous flag", () => {
		const testDir = join(import.meta.dir, ".test-new-autonomous-tmp");

		beforeEach(async () => {
			await mkdir(testDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		test("should write initial agent state when --autonomous flag is provided", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: [
					"feature-autonomous",
					"--autonomous",
					"--task",
					"Test autonomous task",
				],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-autonomous", testDir);
			expect(state).toBeDefined();
			expect(state?.status).toBe("pending");
			expect(state?.task).toBe("Test autonomous task");
			expect(state?.branch).toBe("feature-autonomous");
			expect(state?.base_branch).toBe("main"); // From mock exec
		});

		test("should work with -a shorthand flag", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-shorthand", "-a", "--task", "Shorthand test"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-shorthand", testDir);
			expect(state).toBeDefined();
			expect(state?.status).toBe("pending");
		});

		test("should set worktree_path in agent state", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-path", "--autonomous"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-path", testDir);
			expect(state?.worktree_path).toBeDefined();
			expect(state?.worktree_path).toContain("feature-path");
		});

		test("should set spawned_at timestamp in agent state", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			const beforeTime = new Date().toISOString();
			await newCommand.run({
				args: ["feature-timestamp", "--autonomous"],
				exec,
				...io,
				rootDir: testDir,
			});
			const afterTime = new Date().toISOString();

			const state = await readAgentState("feature-timestamp", testDir);
			expect(state?.spawned_at).toBeDefined();
			// Check timestamp is within the time window
			expect(state?.spawned_at && state.spawned_at >= beforeTime).toBe(true);
			expect(state?.spawned_at && state.spawned_at <= afterTime).toBe(true);
			// started_at should match spawned_at initially (will be updated by gf started)
			expect(state?.started_at).toBe(state?.spawned_at);
		});

		test("should use 'No task specified' when no task provided with --autonomous", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-no-task", "--autonomous"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-no-task", testDir);
			expect(state?.task).toBe("No task specified");
		});

		test("should append completion reminder via --append-system-prompt", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-reminder", "--autonomous", "--task", "Original task"],
				exec,
				...io,
				rootDir: testDir,
			});

			// The command output should use --append-system-prompt with finish reminder
			const taskOutput = stdoutMessages.find((msg) => msg.includes("claude"));
			expect(taskOutput).toContain("--append-system-prompt");
			expect(taskOutput).toContain("gf finish");
		});

		test("should not write agent state without --autonomous flag", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-no-autonomous", "--task", "No autonomous"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-no-autonomous", testDir);
			expect(state).toBeNull();
		});

		test("should not append completion reminder without --autonomous flag", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-no-reminder", "--task", "Simple task"],
				exec,
				...io,
				rootDir: testDir,
			});

			const taskOutput = stdoutMessages.find((msg) => msg.includes("claude"));
			expect(taskOutput).not.toContain("--append-system-prompt");
			expect(taskOutput).not.toContain("gitterflow skill");
		});
	});

	describe("headless mode (--headless flag)", () => {
		const testDir = join(import.meta.dir, ".test-new-headless-tmp");

		beforeEach(async () => {
			await mkdir(testDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		test("should output JSON when --headless flag is provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: ["feature-headless", "--headless"],
				exec,
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			// Should output exactly one line of JSON
			expect(stdoutMessages).toHaveLength(1);

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.success).toBe(true);
			expect(output.branch).toBe("feature-headless");
			expect(output.worktree).toContain("feature-headless");
			expect(output.baseBranch).toBe("main");
		});

		test("should support -H shorthand for --headless", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const exitCode = await newCommand.run({
				args: ["feature-headless-short", "-H"],
				exec,
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.success).toBe(true);
			expect(output.branch).toBe("feature-headless-short");
		});

		test("should include task in headless JSON output", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-with-task", "--headless", "--task", "Implement feature X"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.task).toBe("Implement feature X");
			expect(output.agentCommand).toContain("Implement feature X");
		});

		test("should include autonomous flag in headless JSON output", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-auto-headless", "--headless", "--autonomous"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.autonomous).toBe(true);
		});

		test("should include planFirst flag in headless JSON output", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-plan-headless", "--headless", "--plan-first"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.planFirst).toBe(true);
		});

		test("should still write agent state with --headless --autonomous", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-headless-state", "--headless", "--autonomous", "--task", "Test task"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-headless-state", testDir);
			expect(state).not.toBeNull();
			expect(state?.branch).toBe("feature-headless-state");
			expect(state?.task).toBe("Test task");
			expect(state?.status).toBe("pending");
		});

		test("should include agentCommand in headless JSON output", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-cmd", "--headless", "--task", "Do something"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.agentCommand).toBeDefined();
			expect(output.agentCommand).toContain("claude");
		});

		test("should generate random branch name with --headless when no branch provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["--headless"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.success).toBe(true);
			expect(output.branch).toMatch(/^worktree-\w+-\w+-\d+$/);
		});
	});

	describe("spawn mode (--spawn flag)", () => {
		const testDir = join(import.meta.dir, ".test-new-spawn-tmp");

		beforeEach(async () => {
			await mkdir(testDir, { recursive: true });
		});

		afterEach(async () => {
			await rm(testDir, { recursive: true, force: true });
		});

		test("should imply --headless and --autonomous when --spawn is used", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-spawn", "--spawn", "--task", "Test spawn"],
				exec,
				...io,
				rootDir: testDir,
			});

			// Should output JSON (headless implied)
			expect(stdoutMessages).toHaveLength(1);
			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.success).toBe(true);
			expect(output.spawn).toBe(true);
			expect(output.autonomous).toBe(true);
		});

		test("should include -p flag in agentCommand for spawn mode", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-spawn-p", "--spawn", "--task", "Test"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.agentCommand).toContain("claude -p");
		});

		test("should include --allowedTools in agentCommand for spawn mode", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-spawn-tools", "--spawn", "--task", "Test"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.agentCommand).toContain("--allowedTools");
		});

		test("should use custom --allowed-tools when provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-custom-tools", "--spawn", "--task", "Test", "--allowed-tools", "Read,Bash"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.agentCommand).toContain("Read,Bash");
		});

		test("should support -s shorthand for --spawn", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-spawn-short", "-s", "--task", "Test"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.spawn).toBe(true);
		});

		test("should track parent branch when --parent is provided", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await newCommand.run({
				args: ["feature-child", "--spawn", "--task", "Child task", "--parent", "feature-parent"],
				exec,
				...io,
				rootDir: testDir,
			});

			const output = JSON.parse(stdoutMessages[0] ?? "{}");
			expect(output.parent).toBe("feature-parent");
		});

		test("should set status to running for spawned agents", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();

			await newCommand.run({
				args: ["feature-spawn-status", "--spawn", "--task", "Test"],
				exec,
				...io,
				rootDir: testDir,
			});

			const state = await readAgentState("feature-spawn-status", testDir);
			expect(state?.status).toBe("running");
		});
	});
});
