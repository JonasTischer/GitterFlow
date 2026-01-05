import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { finishCommand } from "../../../src/commands/finish";
import type { AgentState } from "../../../src/utils/agent-state";
import {
	readAgentState,
	writeAgentState,
} from "../../../src/utils/agent-state";
import { commandIO } from "../test-helpers";

describe("finish command", () => {
	const testDir = join(import.meta.dir, ".test-finish-tmp");

	beforeEach(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("agent state updates", () => {
		// Helper to create a mock exec that simulates git operations
		const createMockExec = (options: {
			currentBranch: string;
			baseBranch?: string;
			mergeSuccess?: boolean;
			mergeConflict?: boolean;
		}) => {
			const {
				currentBranch,
				baseBranch = "main",
				mergeSuccess = true,
				mergeConflict = false,
			} = options;

			return async (strings: TemplateStringsArray, ...values: unknown[]) => {
				const command = strings.join("{{VALUE}}");
				const fullCommand = values.reduce(
					(cmd: string, val: unknown) => cmd.replace("{{VALUE}}", String(val)),
					command,
				) as string;

				// Mock git rev-parse --abbrev-ref HEAD
				if (fullCommand.includes("git rev-parse --abbrev-ref HEAD")) {
					return { text: async () => currentBranch };
				}

				// Mock git config for base branch lookup
				if (fullCommand.includes("gitterflow-base-branch")) {
					return { text: async () => baseBranch };
				}

				// Mock git rev-parse --git-common-dir
				if (fullCommand.includes("git rev-parse --git-common-dir")) {
					return { text: async () => ".git" };
				}

				// Mock git fetch
				if (fullCommand.includes("git fetch")) {
					return {};
				}

				// Mock git checkout
				if (fullCommand.includes("git checkout")) {
					return {};
				}

				// Mock git pull
				if (fullCommand.includes("git pull")) {
					return {};
				}

				// Mock git merge
				if (fullCommand.includes("git merge")) {
					if (mergeConflict) {
						throw new Error("CONFLICT (content): Merge conflict in file.txt");
					}
					if (!mergeSuccess) {
						throw new Error("git merge failed");
					}
					return {};
				}

				// Mock git show-ref
				if (fullCommand.includes("git show-ref")) {
					return {};
				}

				// Mock git worktree remove
				if (fullCommand.includes("git worktree remove")) {
					return {};
				}

				// Mock git branch -d
				if (fullCommand.includes("git branch -d")) {
					return {};
				}

				// Mock git push
				if (fullCommand.includes("git push")) {
					return {};
				}

				// Mock git add
				if (fullCommand.includes("git add")) {
					return {};
				}

				// Mock git diff (no changes)
				if (fullCommand.includes("git diff --cached")) {
					return { text: async () => "" };
				}

				return {};
			};
		};

		test("should update agent state to 'merged' on successful merge", async () => {
			const { io } = commandIO();

			// Setup: create initial agent state
			const initialState: AgentState = {
				branch: "feature-merge-success",
				task: "Test successful merge",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(initialState, testDir);

			// Execute: run finish command
			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec: createMockExec({
					currentBranch: "feature-merge-success",
					baseBranch: "main",
					mergeSuccess: true,
				}),
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);

			// Verify: agent state should be updated to merged
			const state = await readAgentState("feature-merge-success", testDir);
			expect(state?.status).toBe("merged");
			expect(state?.completed_at).toBeDefined();
		});

		test("should update agent state to 'conflict' on merge conflict", async () => {
			const { io, stderrMessages } = commandIO();

			// Setup: create initial agent state
			const initialState: AgentState = {
				branch: "feature-merge-conflict",
				task: "Test merge conflict",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(initialState, testDir);

			// Execute: run finish command
			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec: createMockExec({
					currentBranch: "feature-merge-conflict",
					baseBranch: "main",
					mergeConflict: true,
				}),
				rootDir: testDir,
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages.join("\n")).toContain("conflict");

			// Verify: agent state should be updated to conflict
			const state = await readAgentState("feature-merge-conflict", testDir);
			expect(state?.status).toBe("conflict");
			expect(state?.error).toContain("conflict");
		});

		test("should update agent state to 'failed' on other errors", async () => {
			const { io } = commandIO();

			// Setup: create initial agent state
			const initialState: AgentState = {
				branch: "feature-merge-failed",
				task: "Test merge failure",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(initialState, testDir);

			// Execute: run finish command with a failing merge (not conflict)
			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec: createMockExec({
					currentBranch: "feature-merge-failed",
					baseBranch: "main",
					mergeSuccess: false,
				}),
				rootDir: testDir,
			});

			expect(exitCode).toBe(1);

			// Verify: agent state should be updated to failed
			const state = await readAgentState("feature-merge-failed", testDir);
			expect(state?.status).toBe("failed");
			expect(state?.error).toBeDefined();
		});

		test("should not fail if no agent state exists (non-autonomous worktree)", async () => {
			const { io, stdoutMessages } = commandIO();

			// No agent state created - should still work

			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec: createMockExec({
					currentBranch: "feature-no-state",
					baseBranch: "main",
					mergeSuccess: true,
				}),
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages.join("\n")).toContain("Successfully finished");
		});

		test("should preserve other agent state fields when updating status", async () => {
			const { io } = commandIO();

			// Setup: create initial agent state with all fields
			const initialState: AgentState = {
				branch: "feature-preserve-fields",
				task: "Test preserve fields",
				status: "running",
				started_at: "2024-01-15T10:30:00.000Z",
				worktree_path: "/specific/path/to/worktree",
				base_branch: "develop",
				message: "Working on tests",
			};
			await writeAgentState(initialState, testDir);

			// Execute: run finish command
			await finishCommand.run({
				args: [],
				...io,
				exec: createMockExec({
					currentBranch: "feature-preserve-fields",
					baseBranch: "develop",
					mergeSuccess: true,
				}),
				rootDir: testDir,
			});

			// Verify: other fields should be preserved
			const state = await readAgentState("feature-preserve-fields", testDir);
			expect(state?.status).toBe("merged");
			expect(state?.task).toBe("Test preserve fields");
			expect(state?.started_at).toBe("2024-01-15T10:30:00.000Z");
			expect(state?.worktree_path).toBe("/specific/path/to/worktree");
			expect(state?.base_branch).toBe("develop");
			expect(state?.message).toBe("Working on tests");
		});
	});

	describe("auto-stash/pop functionality", () => {
		// Helper to create a mock exec that tracks stash operations
		const createStashTrackingMockExec = (options: {
			currentBranch: string;
			baseBranch?: string;
			hasUncommittedChangesInBaseDir?: boolean;
			stashPopFails?: boolean;
			mergeSuccess?: boolean;
		}) => {
			const {
				currentBranch,
				baseBranch = "main",
				hasUncommittedChangesInBaseDir = false,
				stashPopFails = false,
				mergeSuccess = true,
			} = options;

			const executedCommands: string[] = [];

			const exec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				const command = strings.join("{{VALUE}}");
				const fullCommand = values.reduce(
					(cmd: string, val: unknown) => cmd.replace("{{VALUE}}", String(val)),
					command,
				) as string;

				executedCommands.push(fullCommand);

				// Mock git rev-parse --abbrev-ref HEAD
				if (fullCommand.includes("git rev-parse --abbrev-ref HEAD")) {
					return { text: async () => currentBranch };
				}

				// Mock git config for base branch lookup
				if (fullCommand.includes("gitterflow-base-branch")) {
					return { text: async () => baseBranch };
				}

				// Mock git rev-parse --git-common-dir
				if (fullCommand.includes("git rev-parse --git-common-dir")) {
					return { text: async () => ".git" };
				}

				// Mock git status --porcelain (for checking uncommitted changes in base dir)
				if (fullCommand.includes("git status --porcelain")) {
					return {
						text: async () =>
							hasUncommittedChangesInBaseDir ? " M some-file.txt\n" : "",
					};
				}

				// Mock git stash push
				if (fullCommand.includes("git stash push")) {
					return {};
				}

				// Mock git stash pop
				if (fullCommand.includes("git stash pop")) {
					if (stashPopFails) {
						throw new Error(
							"error: Your local changes would be overwritten by merge",
						);
					}
					return {};
				}

				// Mock git fetch
				if (fullCommand.includes("git fetch")) {
					return {};
				}

				// Mock git checkout
				if (fullCommand.includes("git checkout")) {
					// Simulate base branch already checked out in main repo
					const checkoutError = new Error(
						`fatal: '${baseBranch}' is already checked out at '/main/repo'`,
					);
					(checkoutError as { exitCode?: number }).exitCode = 128;
					throw checkoutError;
				}

				// Mock git pull
				if (fullCommand.includes("git pull")) {
					return {};
				}

				// Mock git merge
				if (fullCommand.includes("git merge")) {
					if (!mergeSuccess) {
						throw new Error("CONFLICT (content): Merge conflict in file.txt");
					}
					return {};
				}

				// Mock git show-ref
				if (fullCommand.includes("git show-ref")) {
					return {};
				}

				// Mock git worktree remove
				if (fullCommand.includes("git worktree remove")) {
					return {};
				}

				// Mock git branch -d
				if (fullCommand.includes("git branch -d")) {
					return {};
				}

				// Mock git push
				if (fullCommand.includes("git push")) {
					return {};
				}

				// Mock git add
				if (fullCommand.includes("git add")) {
					return {};
				}

				// Mock git diff (no changes in worktree)
				if (fullCommand.includes("git diff --cached")) {
					return { text: async () => "" };
				}

				return {};
			};

			return { exec, executedCommands };
		};

		test("should auto-stash uncommitted changes in base branch before merge", async () => {
			const { io, stdoutMessages } = commandIO();
			const { exec, executedCommands } = createStashTrackingMockExec({
				currentBranch: "feature-auto-stash",
				baseBranch: "main",
				hasUncommittedChangesInBaseDir: true,
				mergeSuccess: true,
			});

			await finishCommand.run({
				args: [],
				...io,
				exec,
				rootDir: testDir,
			});

			// Verify stash push was called with appropriate message
			const stashPushCommand = executedCommands.find((cmd) =>
				cmd.includes("git stash push"),
			);
			expect(stashPushCommand).toBeDefined();
			expect(stashPushCommand).toContain("gf-finish");
			expect(stashPushCommand).toContain("feature-auto-stash");

			// Verify output mentions stashing
			const allOutput = stdoutMessages.join("\n");
			expect(allOutput).toContain("stash");
		});

		test("should auto-pop stash after successful merge", async () => {
			const { io, stdoutMessages } = commandIO();
			const { exec, executedCommands } = createStashTrackingMockExec({
				currentBranch: "feature-auto-pop",
				baseBranch: "main",
				hasUncommittedChangesInBaseDir: true,
				mergeSuccess: true,
			});

			await finishCommand.run({
				args: [],
				...io,
				exec,
				rootDir: testDir,
			});

			// Verify stash pop was called
			const stashPopCommand = executedCommands.find((cmd) =>
				cmd.includes("git stash pop"),
			);
			expect(stashPopCommand).toBeDefined();

			// Verify output mentions restoring
			const allOutput = stdoutMessages.join("\n");
			expect(allOutput).toContain("Restored");
		});

		test("should warn but not fail if stash pop fails", async () => {
			const { io, stdoutMessages, stderrMessages } = commandIO();
			const { exec } = createStashTrackingMockExec({
				currentBranch: "feature-pop-fail",
				baseBranch: "main",
				hasUncommittedChangesInBaseDir: true,
				stashPopFails: true,
				mergeSuccess: true,
			});

			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec,
				rootDir: testDir,
			});

			// Should still succeed (exit code 0) - merge was successful
			expect(exitCode).toBe(0);

			// Should warn about the failed pop
			const allOutput = [...stdoutMessages, ...stderrMessages].join("\n");
			expect(allOutput).toContain("Warning");
			expect(allOutput).toContain("git stash pop");
		});

		test("should not stash if base branch has no uncommitted changes", async () => {
			const { io } = commandIO();
			const { exec, executedCommands } = createStashTrackingMockExec({
				currentBranch: "feature-no-stash-needed",
				baseBranch: "main",
				hasUncommittedChangesInBaseDir: false,
				mergeSuccess: true,
			});

			await finishCommand.run({
				args: [],
				...io,
				exec,
				rootDir: testDir,
			});

			// Verify no stash commands were called
			const stashCommands = executedCommands.filter(
				(cmd) =>
					cmd.includes("git stash push") || cmd.includes("git stash pop"),
			);
			expect(stashCommands.length).toBe(0);
		});

		test("should not pop stash if merge fails", async () => {
			const { io } = commandIO();
			const { exec, executedCommands } = createStashTrackingMockExec({
				currentBranch: "feature-merge-fail-no-pop",
				baseBranch: "main",
				hasUncommittedChangesInBaseDir: true,
				mergeSuccess: false,
			});

			const exitCode = await finishCommand.run({
				args: [],
				...io,
				exec,
				rootDir: testDir,
			});

			expect(exitCode).toBe(1);

			// Verify stash push was called (before merge)
			const stashPushCommand = executedCommands.find((cmd) =>
				cmd.includes("git stash push"),
			);
			expect(stashPushCommand).toBeDefined();

			// Verify stash pop was NOT called (merge failed)
			const stashPopCommand = executedCommands.find((cmd) =>
				cmd.includes("git stash pop"),
			);
			expect(stashPopCommand).toBeUndefined();
		});
	});
});
