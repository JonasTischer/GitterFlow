import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { statusCommand } from "../../../src/commands/status";
import type { AgentState } from "../../../src/utils/agent-state";
import { writeAgentState } from "../../../src/utils/agent-state";
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
});
