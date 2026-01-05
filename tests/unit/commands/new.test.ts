import { describe, expect, test } from "bun:test";
import { newCommand } from "../../../src/commands/new";
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
});
