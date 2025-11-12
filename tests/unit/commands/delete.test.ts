import { describe, expect, test } from "bun:test";
import { deleteCommand } from "../../../src/commands/delete";
import { captureExec, commandIO, noExec } from "../test-helpers";

/**
 * Test Suite: delete command
 *
 * Purpose: Verify that the `gf delete <branch>` command correctly removes
 * Git worktrees and handles all edge cases properly.
 *
 * What the delete command does:
 * - Removes a Git worktree directory (e.g., ../feature-branch)
 * - Cleans up Git's internal worktree tracking
 * - Validates input and provides helpful error messages
 *
 * Testing approach:
 * - Use mock exec functions to test without actually running git commands
 * - Verify correct git commands are constructed
 * - Test error handling for various failure scenarios
 * - Ensure proper validation of branch names
 */
describe("delete command", () => {
	/**
	 * Test Group: Argument Validation
	 *
	 * Purpose: Ensure the command properly validates user input before
	 * attempting to delete anything. This prevents accidental deletions
	 * and provides clear error messages.
	 */
	describe("argument validation", () => {
		/**
		 * Test: Missing branch name
		 *
		 * Scenario: User runs `gf delete` without specifying a branch
		 * Expected: Command should fail with exit code 1 and show helpful error
		 *
		 * Why this matters: Prevents accidental execution with no target
		 */
		test("should fail when no branch name is provided", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await deleteCommand.run({
				args: [], // Empty args array = no branch name
				exec: noExec, // Should not execute git command
				...io,
			});

			// Verify failure
			expect(exitCode).toBe(1);
			expect(stderrMessages).toHaveLength(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});

		/**
		 * Test: Empty string branch name
		 *
		 * Scenario: User provides empty string as branch name
		 * Expected: Should be treated same as missing argument
		 */
		test("should fail when branch name is empty string", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await deleteCommand.run({
				args: [""], // Empty string
				exec: noExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});

		/**
		 * Test: Whitespace-only branch name
		 *
		 * Scenario: User provides only spaces/tabs as branch name
		 * Expected: Should be rejected as invalid input
		 *
		 * Why this matters: Prevents creating/deleting worktrees with invalid names
		 */
		test("should fail when branch name is only whitespace", async () => {
			const { io, stderrMessages } = commandIO();

			const exitCode = await deleteCommand.run({
				args: ["   "], // Only spaces
				exec: noExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Please provide a branch name");
		});
	});

	/**
	 * Test Group: Git Worktree Removal
	 *
	 * Purpose: Verify that the command constructs the correct git command
	 * and successfully removes worktrees.
	 */
	describe("git worktree removal", () => {
		/**
		 * Test: Basic worktree removal
		 *
		 * Scenario: User wants to delete a feature branch worktree
		 * Expected: Executes `git worktree remove ../branch-name`
		 *
		 * How it works:
		 * 1. captureExec() creates a mock function that records what would be executed
		 * 2. We run the delete command with a test branch name
		 * 3. We verify the correct git command was constructed
		 * 4. We check the success message was displayed
		 */
		test("should remove worktree for specified branch", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages, stderrMessages } = commandIO();

			const exitCode = await deleteCommand.run({
				args: ["feature/my-feature"],
				exec,
				...io,
			});

			// Should succeed
			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);

			// Should show success message
			expect(stdoutMessages).toHaveLength(1);
			expect(stdoutMessages[0]).toContain("Removed worktree");
			expect(stdoutMessages[0]).toContain("feature/my-feature");
			expect(stdoutMessages[0]).toContain("🗑"); // Trash emoji

			// Should execute correct git command
			expect(calls).toHaveLength(1);
			const commandString = calls[0]?.strings.join("");
			expect(commandString).toContain("git worktree remove");
			expect(calls[0]?.values).toContain("feature/my-feature");
		});

		/**
		 * Test: Worktree path construction
		 *
		 * Scenario: Verify the worktree path is constructed correctly
		 * Expected: Path should be ../branch-name (parent directory)
		 *
		 * Why this matters: GitterFlow stores worktrees in parallel directories
		 * Example: If you're in /code/project, worktree is at /code/branch-name
		 */
		test("should use correct worktree path in parent directory", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await deleteCommand.run({
				args: ["my-branch"],
				exec,
				...io,
			});

			// Reconstruct the full command to verify path
			const commandStr = calls[0]?.strings.join("{{VALUE}}") ?? "";
			const fullCommand = calls[0]?.values.reduce(
				(cmd: string, val: unknown) => cmd.replace("{{VALUE}}", String(val)),
				commandStr,
			);

			expect(fullCommand).toContain("../my-branch");
		});

		/**
		 * Test: Branch names with slashes
		 *
		 * Scenario: Branch names like "feature/auth" or "bugfix/issue-123"
		 * Expected: Should handle the slash correctly
		 *
		 * Why this matters: Common Git convention uses slashes for namespacing
		 */
		test("should handle branch names with slashes", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await deleteCommand.run({
				args: ["bugfix/login-error"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("bugfix/login-error");
			expect(calls[0]?.values).toContain("bugfix/login-error");
		});

		/**
		 * Test: Branch names with hyphens
		 *
		 * Scenario: Branch names like "fix-bug-123"
		 * Expected: Should handle hyphens correctly
		 */
		test("should handle branch names with hyphens", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			await deleteCommand.run({
				args: ["my-feature-branch"],
				exec,
				...io,
			});

			expect(calls[0]?.values).toContain("my-feature-branch");
		});

		/**
		 * Test: Ignore extra arguments
		 *
		 * Scenario: User provides extra arguments beyond branch name
		 * Expected: Only use the first argument, ignore the rest
		 *
		 * Why this matters: Prevents confusion from typos or extra input
		 */
		test("should only delete first branch if multiple args provided", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await deleteCommand.run({
				args: ["branch-to-delete", "extra", "args"],
				exec,
				...io,
			});

			// Should only mention the first branch
			expect(stdoutMessages[0]).toContain("branch-to-delete");
			expect(stdoutMessages[0]).not.toContain("extra");

			// Should only delete the first branch
			expect(calls[0]?.values).toContain("branch-to-delete");
		});
	});

	/**
	 * Test Group: Error Handling
	 *
	 * Purpose: Verify the command handles Git errors gracefully and
	 * provides helpful error messages to the user.
	 */
	describe("error handling", () => {
		/**
		 * Test: Generic git failure
		 *
		 * Scenario: Git command fails for any reason
		 * Expected: Return exit code 1 and show error message
		 *
		 * How the mock works:
		 * - failingExec throws an error instead of running git
		 * - This simulates what happens when git fails
		 * - We verify the command catches the error and returns failure
		 */
		test("should return error code when git command fails", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("git worktree remove failed");
			};

			const exitCode = await deleteCommand.run({
				args: ["test-branch"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages).toHaveLength(1);
			expect(stderrMessages[0]).toContain("Failed to remove worktree");
		});

		/**
		 * Test: Worktree doesn't exist
		 *
		 * Scenario: User tries to delete a worktree that doesn't exist
		 * Expected: Git will fail, command should handle it gracefully
		 *
		 * Why this matters: Common user mistake, should have helpful error
		 */
		test("should handle error when worktree doesn't exist", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("fatal: '../nonexistent' is not a working tree");
			};

			const exitCode = await deleteCommand.run({
				args: ["nonexistent"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Failed to remove worktree");
		});

		/**
		 * Test: Worktree is locked
		 *
		 * Scenario: Worktree is locked (e.g., being used by another process)
		 * Expected: Should show error message explaining the failure
		 */
		test("should handle error when worktree is locked", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("worktree is locked");
			};

			const exitCode = await deleteCommand.run({
				args: ["locked-branch"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toMatch(/Failed to remove worktree|locked/i);
		});

		/**
		 * Test: ShellError with exit code
		 *
		 * Scenario: Git returns a specific exit code (e.g., 128 for errors)
		 * Expected: Command should handle ShellError objects from Bun.$
		 *
		 * Why this matters: Bun.$ throws special ShellError objects that
		 * include exit codes and stderr output
		 */
		test("should handle ShellError with exit code", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				const error = new Error("fatal: invalid path '../test'");
				// ShellError includes exitCode and stderr properties
				(error as unknown as { exitCode: number }).exitCode = 128;
				(error as unknown as { stderr: string }).stderr =
					"fatal: invalid path '../test'\n";
				throw error;
			};

			const exitCode = await deleteCommand.run({
				args: ["test"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Failed to remove worktree");
		});
	});

	/**
	 * Test Group: Success Messages
	 *
	 * Purpose: Verify the command provides clear, helpful success messages
	 */
	describe("success messages", () => {
		/**
		 * Test: Success message format
		 *
		 * Scenario: Successful worktree deletion
		 * Expected: Show message with branch name and trash emoji
		 */
		test("should output success message with branch name", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await deleteCommand.run({
				args: ["feature/awesome"],
				exec,
				...io,
			});

			expect(stdoutMessages).toHaveLength(1);
			expect(stdoutMessages[0]).toContain("Removed worktree");
			expect(stdoutMessages[0]).toContain("feature/awesome");
		});

		/**
		 * Test: Emoji usage
		 *
		 * Scenario: Verify trash emoji is used in success message
		 * Expected: Should include 🗑 emoji for visual feedback
		 */
		test("should use trash emoji in success message", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			await deleteCommand.run({
				args: ["test"],
				exec,
				...io,
			});

			expect(stdoutMessages[0]).toContain("🗑");
		});
	});

	/**
	 * Test Group: --all Flag
	 *
	 * Purpose: Verify the --all flag correctly deletes all worktrees
	 */
	describe("--all flag", () => {
		/**
		 * Test: --all flag detection
		 *
		 * Scenario: User provides --all flag
		 * Expected: Command should detect flag and list all worktrees
		 */
		test("should detect --all flag", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			// Mock git worktree list output
			const mockWorktreeList = `/path/to/repo  abc123 [main]
/path/to/worktree1  def456 [feature-1]
/path/to/worktree2  ghi789 [feature-2]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => "/path/to/repo",
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				return Promise.resolve({});
			};

			await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			// Should call git worktree list
			expect(
				calls.some((c) => c.strings.join("").includes("git worktree list")),
			).toBe(true);
		});

		/**
		 * Test: -a short flag
		 *
		 * Scenario: User provides -a as short form
		 * Expected: Should work same as --all
		 */
		test("should detect -a short flag", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			const mockWorktreeList = `/path/to/repo  abc123 [main]
/path/to/worktree1  def456 [feature-1]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => "/path/to/repo",
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				return Promise.resolve({});
			};

			await deleteCommand.run({
				args: ["-a"],
				exec: execWithMock,
				...io,
			});

			// Should call git worktree list
			expect(
				calls.some((c) => c.strings.join("").includes("git worktree list")),
			).toBe(true);
		});

		/**
		 * Test: Exclude main repo from deletion
		 *
		 * Scenario: Worktree list includes main repo
		 * Expected: Main repo should be excluded from deletion list
		 */
		test("should exclude main repo from deletion", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const mainRepoPath = "/path/to/repo";
			const mockWorktreeList = `${mainRepoPath}  abc123 [main]
/path/to/worktree1  def456 [feature-1]
/path/to/worktree2  a1b2c3 [feature-2]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mainRepoPath,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				// For git worktree remove, just return success
				if (command.includes("git worktree remove")) {
					return Promise.resolve({});
				}

				return Promise.resolve({});
			};

			await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			// Should list 2 worktrees to delete (excluding main)
			const foundMessage = stdoutMessages.find((msg) =>
				msg.includes("Found 2 worktree(s)"),
			);
			expect(foundMessage).toBeDefined();

			// Should not try to delete main repo
			const deleteCalls = calls.filter((c) =>
				c.strings.join("").includes("git worktree remove"),
			);
			expect(deleteCalls.length).toBe(2); // Only 2 deletions, not 3
			// Check that main repo path is not in any of the delete call values
			const mainRepoInValues = deleteCalls.some((c) =>
				c.values.some((v) => String(v).includes(mainRepoPath)),
			);
			expect(mainRepoInValues).toBe(false);
		});

		/**
		 * Test: Delete multiple worktrees
		 *
		 * Scenario: Multiple worktrees exist
		 * Expected: All should be deleted (except main repo)
		 */
		test("should delete all worktrees", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const mainRepoPath = "/path/to/repo";
			const mockWorktreeList = `${mainRepoPath}  abc123 [main]
/path/to/worktree1  def456 [feature-1]
/path/to/worktree2  a1b2c3 [feature-2]
/path/to/worktree3  d4e5f6 [feature-3]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mainRepoPath,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				// For git worktree remove, just return success
				if (command.includes("git worktree remove")) {
					return Promise.resolve({});
				}

				return Promise.resolve({});
			};

			await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			// Should delete 3 worktrees (excluding main repo)
			const deleteCalls = calls.filter((c) =>
				c.strings.join("").includes("git worktree remove"),
			);
			expect(deleteCalls.length).toBe(3);

			// Should show success count
			const successMessage = stdoutMessages.find((msg) =>
				msg.includes("Deleted 3 worktree(s)"),
			);
			expect(successMessage).toBeDefined();
		});

		/**
		 * Test: Empty worktree list
		 *
		 * Scenario: No worktrees exist (only main repo)
		 * Expected: Should show message and exit successfully
		 */
		test("should handle empty worktree list gracefully", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const mainRepoPath = "/path/to/repo";
			const mockWorktreeList = `${mainRepoPath}  abc123 [main]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mainRepoPath,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				return Promise.resolve({});
			};

			const exitCode = await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			expect(exitCode).toBe(0);
			const noWorktreesMessage = stdoutMessages.find(
				(msg) =>
					msg.includes("No worktrees to delete") ||
					msg.includes("only main repository found"),
			);
			expect(noWorktreesMessage).toBeDefined();
		});

		/**
		 * Test: Partial deletion failure
		 *
		 * Scenario: Some worktrees fail to delete
		 * Expected: Should continue deleting others and report failures
		 */
		test("should handle partial deletion failures", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages, stderrMessages } = commandIO();

			const mainRepoPath = "/path/to/repo";
			const mockWorktreeList = `${mainRepoPath}  abc123 [main]
/path/to/worktree1  def456 [feature-1]
/path/to/worktree2  a1b2c3 [feature-2]`;

			let deleteCallCount = 0;
			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mainRepoPath,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git worktree remove")) {
					deleteCallCount++;
					// Fail on second deletion
					if (deleteCallCount === 2) {
						throw new Error("Failed to remove worktree2");
					}
				}

				return Promise.resolve({});
			};

			const exitCode = await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			// Should return error code due to failures
			expect(exitCode).toBe(1);

			// Should show success count
			const successMessage = stdoutMessages.find((msg) =>
				msg.includes("Deleted 1 worktree(s)"),
			);
			expect(successMessage).toBeDefined();

			// Should show failure count
			const failureMessage = stderrMessages.find((msg) =>
				msg.includes("Failed to delete 1 worktree(s)"),
			);
			expect(failureMessage).toBeDefined();
		});

		/**
		 * Test: List worktrees failure
		 *
		 * Scenario: git worktree list fails
		 * Expected: Should show error and exit with code 1
		 */
		test("should handle git worktree list failure", async () => {
			const { io, stderrMessages } = commandIO();

			const failingExec = async () => {
				throw new Error("git worktree list failed");
			};

			const exitCode = await deleteCommand.run({
				args: ["--all"],
				exec: failingExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages[0]).toContain("Failed to list worktrees");
		});

		/**
		 * Test: Display worktree list before deletion
		 *
		 * Scenario: User runs --all
		 * Expected: Should show which worktrees will be deleted
		 */
		test("should display worktrees to be deleted", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();

			const mainRepoPath = "/path/to/repo";
			const mockWorktreeList = `${mainRepoPath}  abc123 [main]
/path/to/worktree1  def456 [feature-1]
/path/to/worktree2  a1b2c3 [feature-2]`;

			const execWithMock = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				const command = strings.join("");

				if (command.includes("git worktree list")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mockWorktreeList,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				if (command.includes("git rev-parse --show-toplevel")) {
					const mockResult: { text: () => Promise<string> } = {
						text: async () => mainRepoPath,
					};
					return Object.assign(Promise.resolve(mockResult), mockResult) as
						| Promise<{ text: () => Promise<string> }>
						| { text: () => Promise<string> };
				}

				// For git worktree remove, just return success
				if (command.includes("git worktree remove")) {
					return Promise.resolve({});
				}

				return Promise.resolve({});
			};

			await deleteCommand.run({
				args: ["--all"],
				exec: execWithMock,
				...io,
			});

			// Should show list of worktrees to delete
			const listMessage = stdoutMessages.find((msg) =>
				msg.includes("Found 2 worktree(s) to delete"),
			);
			expect(listMessage).toBeDefined();

			// Should list each worktree (check in the combined stdout messages)
			const allMessages = stdoutMessages.join("\n");
			expect(allMessages).toContain("feature-1");
			expect(allMessages).toContain("feature-2");
		});
	});
});
