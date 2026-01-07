import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { statusCommand } from "../../../src/commands/status";
import type { AgentState } from "../../../src/utils/agent-state";
import {
	readAgentState,
	writeAgentState,
} from "../../../src/utils/agent-state";
import { commandIO } from "../test-helpers";

describe("status command", () => {
	const testDir = join(import.meta.dir, ".test-status-tmp");
	const agentsDir = join(testDir, ".gitterflow", "agents");

	beforeEach(async () => {
		await mkdir(agentsDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("when no agents exist", () => {
		test("should display 'No autonomous agents found.' message", async () => {
			const { io, stdoutMessages } = commandIO();

			// Use empty dir (no agent files)
			const emptyDir = join(testDir, "empty");
			await mkdir(emptyDir, { recursive: true });

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: emptyDir,
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages.join("\n")).toContain(
				"No autonomous agents found.",
			);
		});
	});

	describe("when agents exist", () => {
		test("should display table with agent information", async () => {
			const { io, stdoutMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-shell-completions",
				task: "Implement shell completions for all commands",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			expect(output).toContain("Branch");
			expect(output).toContain("Status");
			expect(output).toContain("Task");
			expect(output).toContain("Started");
			expect(output).toContain("feature-shell-completions");
			expect(output).toContain("running");
		});

		test("should truncate long task descriptions", async () => {
			const { io, stdoutMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-long-task",
				task: "This is a very long task description that should be truncated because it exceeds the maximum allowed width for the table",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			// Task should be truncated with ellipsis
			expect(output).toContain("...");
			// Full task should not appear
			expect(output).not.toContain(
				"This is a very long task description that should be truncated because it exceeds the maximum allowed width for the table",
			);
		});

		test("should display relative time for started_at", async () => {
			const { io, stdoutMessages } = commandIO();

			// Create a state that started 2 minutes ago
			const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
			const state: AgentState = {
				branch: "feature-recent",
				task: "Recent task",
				status: "running",
				started_at: twoMinutesAgo.toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			// Should show relative time like "2 min ago" or similar
			expect(output).toMatch(/\d+\s*(min|sec|hour|day).*ago/i);
		});

		test("should display '(spawned)' suffix for pending agents", async () => {
			const { io, stdoutMessages } = commandIO();

			// Create a pending agent state with spawned_at
			const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
			const state: AgentState = {
				branch: "feature-pending",
				task: "Pending task",
				status: "pending",
				started_at: twoMinutesAgo.toISOString(),
				spawned_at: twoMinutesAgo.toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			// Should show "(spawned)" for pending agents
			expect(output).toContain("(spawned)");
			// Should still show relative time
			expect(output).toMatch(/\d+\s*(min|sec).*ago.*\(spawned\)/i);
		});

		test("should use spawned_at time for pending agents", async () => {
			const { io, stdoutMessages } = commandIO();

			// spawned_at is 5 minutes ago, started_at is later (shouldn't matter for pending)
			const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
			const state: AgentState = {
				branch: "feature-pending-time",
				task: "Pending time test",
				status: "pending",
				started_at: fiveMinutesAgo.toISOString(),
				spawned_at: fiveMinutesAgo.toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			// Should show 5 min ago (using spawned_at)
			expect(output).toContain("5 min ago");
		});

		test("should NOT display '(spawned)' suffix for running agents", async () => {
			const { io, stdoutMessages } = commandIO();

			const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
			const state: AgentState = {
				branch: "feature-running",
				task: "Running task",
				status: "running",
				started_at: twoMinutesAgo.toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");
			// Should NOT show "(spawned)" for running agents
			expect(output).not.toContain("(spawned)");
		});
	});

	describe("status grouping and ordering", () => {
		test("should group agents by status: running first, then pending, completed, failed, conflict, merged", async () => {
			const { io, stdoutMessages } = commandIO();

			const baseTime = new Date();

			// Create agents with different statuses
			const states: AgentState[] = [
				{
					branch: "feature-merged",
					task: "Merged task",
					status: "merged",
					started_at: new Date(baseTime.getTime() - 6000).toISOString(),
					worktree_path: "/path/merged",
					base_branch: "main",
				},
				{
					branch: "feature-running",
					task: "Running task",
					status: "running",
					started_at: new Date(baseTime.getTime() - 2000).toISOString(),
					worktree_path: "/path/running",
					base_branch: "main",
				},
				{
					branch: "feature-failed",
					task: "Failed task",
					status: "failed",
					started_at: new Date(baseTime.getTime() - 4000).toISOString(),
					worktree_path: "/path/failed",
					base_branch: "main",
					error: "Some error",
				},
				{
					branch: "feature-pending",
					task: "Pending task",
					status: "pending",
					started_at: new Date(baseTime.getTime() - 1000).toISOString(),
					worktree_path: "/path/pending",
					base_branch: "main",
				},
				{
					branch: "feature-completed",
					task: "Completed task",
					status: "completed",
					started_at: new Date(baseTime.getTime() - 3000).toISOString(),
					worktree_path: "/path/completed",
					base_branch: "main",
				},
				{
					branch: "feature-conflict",
					task: "Conflict task",
					status: "conflict",
					started_at: new Date(baseTime.getTime() - 5000).toISOString(),
					worktree_path: "/path/conflict",
					base_branch: "main",
				},
			];

			for (const state of states) {
				await writeAgentState(state, testDir);
			}

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");

			// Find positions of each status in output
			const runningPos = output.indexOf("feature-running");
			const pendingPos = output.indexOf("feature-pending");
			const completedPos = output.indexOf("feature-completed");
			const failedPos = output.indexOf("feature-failed");
			const conflictPos = output.indexOf("feature-conflict");
			const mergedPos = output.indexOf("feature-merged");

			// Verify ordering: running < pending < completed < failed < conflict < merged
			expect(runningPos).toBeLessThan(pendingPos);
			expect(pendingPos).toBeLessThan(completedPos);
			expect(completedPos).toBeLessThan(failedPos);
			expect(failedPos).toBeLessThan(conflictPos);
			expect(conflictPos).toBeLessThan(mergedPos);
		});
	});

	describe("table formatting", () => {
		test("should display header row with proper columns", async () => {
			const { io, stdoutMessages } = commandIO();

			const state: AgentState = {
				branch: "test-branch",
				task: "Test task",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");

			// Check for header title
			expect(output).toContain("AUTONOMOUS AGENTS");
			// Check for column headers
			expect(output).toContain("Branch");
			expect(output).toContain("Status");
			expect(output).toContain("Task");
			expect(output).toContain("Started");
		});

		test("should display separator lines", async () => {
			const { io, stdoutMessages } = commandIO();

			const state: AgentState = {
				branch: "test-branch",
				task: "Test task",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: [],
				...io,
				rootDir: testDir,
			});

			expect(exitCode).toBe(0);
			const output = stdoutMessages.join("\n");

			// Should have separator lines (dashes)
			expect(output).toMatch(/─+/);
		});
	});

	describe("command metadata", () => {
		test("should have correct name", () => {
			expect(statusCommand.name).toBe("status");
		});

		test("should have a description", () => {
			expect(statusCommand.description).toBeDefined();
			expect(statusCommand.description.length).toBeGreaterThan(0);
		});

		test("should have usage information", () => {
			expect(statusCommand.usage).toBeDefined();
			expect(statusCommand.usage).toContain("gitterflow status");
		});
	});

	describe("--write flag", () => {
		// Helper to create exec that returns a specific branch name
		const createMockExec = (branchName: string) => {
			return async (strings: TemplateStringsArray) => {
				const command = strings.join("");
				if (command.includes("git rev-parse --abbrev-ref HEAD")) {
					return {
						text: async () => branchName,
					};
				}
				return {};
			};
		};

		test("should update agent message when --write flag is provided", async () => {
			const { io, stdoutMessages } = commandIO();

			// Setup: create initial agent state
			const state: AgentState = {
				branch: "feature-write-test",
				task: "Test write flag",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			// Execute: run status --write with mock exec
			const exitCode = await statusCommand.run({
				args: ["--write", "Working on authentication"],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-write-test"),
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages.join("\n")).toContain("Status updated");

			// Verify: check updated state
			const updatedState = await readAgentState("feature-write-test", testDir);
			expect(updatedState?.message).toBe("Working on authentication");
		});

		test("should work with -w shorthand flag", async () => {
			const { io, stdoutMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-shorthand",
				task: "Test shorthand",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: ["-w", "Running tests"],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-shorthand"),
			});

			expect(exitCode).toBe(0);
			expect(stdoutMessages.join("\n")).toContain("Status updated");

			const updatedState = await readAgentState("feature-shorthand", testDir);
			expect(updatedState?.message).toBe("Running tests");
		});

		test("should error when no message provided with --write", async () => {
			const { io, stderrMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-no-message",
				task: "Test no message",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: ["--write"],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-no-message"),
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages.join("\n")).toContain("Message required");
		});

		test("should error when message starts with dash (likely another flag)", async () => {
			const { io, stderrMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-dash-message",
				task: "Test dash message",
				status: "running",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await statusCommand.run({
				args: ["--write", "--verbose"],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-dash-message"),
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages.join("\n")).toContain("Message required");
		});

		test("should error when no agent state exists for current branch", async () => {
			const { io, stderrMessages } = commandIO();

			// No agent state created - should error
			const exitCode = await statusCommand.run({
				args: ["--write", "Some message"],
				...io,
				rootDir: testDir,
				exec: createMockExec("non-existent-branch"),
			});

			expect(exitCode).toBe(1);
			expect(stderrMessages.join("\n")).toContain("No autonomous agent found");
		});

		test("should preserve other agent state fields when updating message", async () => {
			const { io } = commandIO();

			const originalState: AgentState = {
				branch: "feature-preserve",
				task: "Test preserve fields",
				status: "running",
				started_at: "2024-01-15T10:30:00.000Z",
				worktree_path: "/specific/path",
				base_branch: "develop",
			};
			await writeAgentState(originalState, testDir);

			await statusCommand.run({
				args: ["--write", "New message"],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-preserve"),
			});

			const updatedState = await readAgentState("feature-preserve", testDir);
			expect(updatedState?.message).toBe("New message");
			expect(updatedState?.task).toBe("Test preserve fields");
			expect(updatedState?.status).toBe("running");
			expect(updatedState?.started_at).toBe("2024-01-15T10:30:00.000Z");
			expect(updatedState?.worktree_path).toBe("/specific/path");
			expect(updatedState?.base_branch).toBe("develop");
		});
	});
});
