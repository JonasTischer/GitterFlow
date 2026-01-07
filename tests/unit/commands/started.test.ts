import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startedCommand } from "../../../src/commands/started";
import type { AgentState } from "../../../src/utils/agent-state";
import {
	readAgentState,
	writeAgentState,
} from "../../../src/utils/agent-state";
import { commandIO } from "../test-helpers";

describe("started command", () => {
	const testDir = join(import.meta.dir, ".test-started-tmp");
	const agentsDir = join(testDir, ".gitterflow", "agents");

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

	beforeEach(async () => {
		await mkdir(agentsDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("command metadata", () => {
		test("should have correct name", () => {
			expect(startedCommand.name).toBe("started");
		});

		test("should have a description", () => {
			expect(startedCommand.description).toBeDefined();
			expect(startedCommand.description.length).toBeGreaterThan(0);
		});

		test("should have usage information", () => {
			expect(startedCommand.usage).toBeDefined();
			expect(startedCommand.usage).toContain("gitterflow started");
		});
	});

	describe("when agent state exists with pending status", () => {
		test("should update status from pending to running", async () => {
			const { io } = commandIO();

			const state: AgentState = {
				branch: "feature-test",
				task: "Test task",
				status: "pending",
				started_at: "2024-01-15T10:00:00.000Z",
				spawned_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-test"),
			});

			expect(exitCode).toBe(0);

			const updatedState = await readAgentState("feature-test", testDir);
			expect(updatedState?.status).toBe("running");
		});

		test("should update started_at to actual start time", async () => {
			const { io } = commandIO();

			const spawnedTime = "2024-01-15T10:00:00.000Z";
			const state: AgentState = {
				branch: "feature-timestamp",
				task: "Test task",
				status: "pending",
				started_at: spawnedTime,
				spawned_at: spawnedTime,
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const beforeTime = new Date().toISOString();
			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-timestamp"),
			});
			const afterTime = new Date().toISOString();

			expect(exitCode).toBe(0);

			const updatedState = await readAgentState("feature-timestamp", testDir);
			expect(updatedState?.started_at).toBeDefined();
			// started_at should be updated to current time, not the original spawned time
			expect(updatedState?.started_at).not.toBe(spawnedTime);
			expect(
				updatedState?.started_at && updatedState.started_at >= beforeTime,
			).toBe(true);
			expect(
				updatedState?.started_at && updatedState.started_at <= afterTime,
			).toBe(true);
		});

		test("should preserve spawned_at timestamp", async () => {
			const { io } = commandIO();

			const spawnedTime = "2024-01-15T10:00:00.000Z";
			const state: AgentState = {
				branch: "feature-preserve-spawned",
				task: "Test task",
				status: "pending",
				started_at: spawnedTime,
				spawned_at: spawnedTime,
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-preserve-spawned"),
			});

			const updatedState = await readAgentState(
				"feature-preserve-spawned",
				testDir,
			);
			expect(updatedState?.spawned_at).toBe(spawnedTime);
		});

		test("should preserve other agent state fields", async () => {
			const { io } = commandIO();

			const state: AgentState = {
				branch: "feature-preserve-fields",
				task: "Original task description",
				status: "pending",
				started_at: "2024-01-15T10:00:00.000Z",
				spawned_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/specific/path",
				base_branch: "develop",
			};
			await writeAgentState(state, testDir);

			await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-preserve-fields"),
			});

			const updatedState = await readAgentState(
				"feature-preserve-fields",
				testDir,
			);
			expect(updatedState?.task).toBe("Original task description");
			expect(updatedState?.worktree_path).toBe("/specific/path");
			expect(updatedState?.base_branch).toBe("develop");
		});
	});

	describe("idempotent behavior", () => {
		test("should silently succeed if no agent state exists (exit 0)", async () => {
			const { io, stderrMessages } = commandIO();

			// No agent state created
			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("non-existent-branch"),
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);
		});

		test("should silently succeed if status is already running", async () => {
			const { io, stderrMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-already-running",
				task: "Test task",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-already-running"),
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);

			// State should remain unchanged
			const updatedState = await readAgentState(
				"feature-already-running",
				testDir,
			);
			expect(updatedState?.status).toBe("running");
			expect(updatedState?.started_at).toBe("2024-01-15T10:00:00.000Z");
		});

		test("should silently succeed if status is completed", async () => {
			const { io, stderrMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-completed",
				task: "Test task",
				status: "completed",
				started_at: "2024-01-15T10:00:00.000Z",
				completed_at: "2024-01-15T11:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};
			await writeAgentState(state, testDir);

			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-completed"),
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);

			// State should remain unchanged
			const updatedState = await readAgentState("feature-completed", testDir);
			expect(updatedState?.status).toBe("completed");
		});

		test("should silently succeed if status is failed", async () => {
			const { io, stderrMessages } = commandIO();

			const state: AgentState = {
				branch: "feature-failed",
				task: "Test task",
				status: "failed",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
				error: "Some error",
			};
			await writeAgentState(state, testDir);

			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("feature-failed"),
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);
		});
	});

	describe("non-autonomous agents", () => {
		test("should silently succeed for agents not tracked by gitterflow", async () => {
			const { io, stderrMessages } = commandIO();

			// No agent state - simulates a non-autonomous worktree
			const exitCode = await startedCommand.run({
				args: [],
				...io,
				rootDir: testDir,
				exec: createMockExec("regular-branch"),
			});

			expect(exitCode).toBe(0);
			expect(stderrMessages).toHaveLength(0);
		});
	});
});
