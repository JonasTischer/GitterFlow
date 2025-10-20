import { describe, expect, test } from "bun:test";
import { startCommand } from "../../src/commands/start";
import { captureExec, commandIO, noExec } from "../utils";

describe("start command", () => {
	describe("argument validation", () => {
		test("should fail when no branch name is provided", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await startCommand.run({
				args: [],
				exec: noExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages).toHaveLength(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});

		test("should fail when branch name is empty string", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await startCommand.run({
				args: [""],
				exec: noExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});

		test("should fail when branch name is only whitespace", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await startCommand.run({
				args: ["   "],
				exec: noExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});
	});

	describe("git worktree creation", () => {
		test("should create new branch and worktree when branch doesn't exist", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages, stderrMessages } = commandIO();

			const exitCode = await startCommand.run({
				args: ["feature/new-feature"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);
			expect(stdoutMessages).toHaveLength(1);
			expect(stdoutMessages[0]).toContain(
				"Created worktree for branch feature/new-feature",
			);

			// Should use -b flag to create new branch
			expect(calls).toHaveLength(1);
			expect(calls[0]?.strings.join("")).toContain("git worktree add");
			expect(calls[0]?.strings.join("")).toContain("-b");
			expect(calls[0]?.values).toContain("feature/new-feature");
		});

		test("should use correct worktree path in parent directory", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await startCommand.run({
				args: ["my-branch"],
				exec,
				...io,
			});

			// Path should be ../my-branch
			const commandStr = calls[0]?.strings.join("{{VALUE}}") ?? "";
			const fullCommand = calls[0]?.values.reduce(
				(cmd: string, val: unknown, _idx: number) =>
					cmd.replace("{{VALUE}}", String(val)),
				commandStr,
			);

			expect(fullCommand).toContain("../my-branch");
		});

		test("should handle branch names with slashes (feature/foo)", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await startCommand.run({
				args: ["feature/authentication"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("feature/authentication");
			expect(calls[0]?.values).toContain("feature/authentication");
		});

		test("should handle branch names with hyphens", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await startCommand.run({
				args: ["fix-bug-123"],
				exec,
				...io,
			});

			expect(calls[0]?.values).toContain("fix-bug-123");
		});
	});

	describe("error handling", () => {
		test("should return error code when git command fails", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("git worktree add failed");
			};

			const exitCode = await startCommand.run({
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

			const failingExec = async () => {
				const error = new Error("fatal: invalid reference: test");
				(error as unknown as { exitCode: number }).exitCode = 128;
				(error as unknown as { stderr: string }).stderr =
					"fatal: invalid reference: test\n";
				throw error;
			};

			const exitCode = await startCommand.run({
				args: ["test-branch"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Failed to create worktree");
		});

		test("should show helpful error message on git failure", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("worktree '../test' already exists");
			};

			await startCommand.run({
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

			await startCommand.run({
				args: ["feature-x"],
				exec,
				...io,
			});

			// The worktree should be created from HEAD (current branch)
			// git worktree add -b feature-x ../feature-x
			expect(calls).toHaveLength(1);
			const cmd = calls[0]?.strings.join("").trim() ?? "";
			expect(cmd).toContain("git worktree add");
			expect(cmd).toContain("-b");
		});

		test("should ignore extra arguments beyond branch name", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await startCommand.run({
				args: ["my-branch", "extra", "args"],
				exec,
				...io,
			});

			// Should only use first argument as branch name
			expect(stdoutMessages[0]).toContain("my-branch");
			expect(stdoutMessages[0]).not.toContain("extra");
			expect(calls[0]?.values).toContain("my-branch");
		});
	});

	describe("success messages", () => {
		test("should output success message with branch name", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await startCommand.run({
				args: ["feature/awesome"],
				exec,
				...io,
			});

			expect(stdoutMessages).toHaveLength(1);
			expect(stdoutMessages[0]).toContain("Created worktree");
			expect(stdoutMessages[0]).toContain("feature/awesome");
		});

		test("should use checkmark emoji in success message", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await startCommand.run({
				args: ["test"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("✅");
		});
	});
});
