import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentState,
	type AgentStatus,
	listAgentStates,
	readAgentState,
	updateAgentStatus,
	writeAgentState,
} from "../../src/utils/agent-state";

describe("Agent State Utility", () => {
	let tempDir: string;

	beforeEach(async () => {
		// Create a temporary directory for each test
		tempDir = await mkdtemp(join(tmpdir(), "gitterflow-test-"));
	});

	afterEach(async () => {
		// Clean up temporary directory after each test
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("AgentState interface", () => {
		test("should have all required fields", () => {
			const state: AgentState = {
				branch: "feature/test-branch",
				task: "Implement user authentication",
				status: "pending",
				started_at: new Date().toISOString(),
				worktree_path: "/path/to/worktree",
				base_branch: "main",
			};

			expect(state.branch).toBe("feature/test-branch");
			expect(state.task).toBe("Implement user authentication");
			expect(state.status).toBe("pending");
			expect(state.started_at).toBeDefined();
			expect(state.worktree_path).toBe("/path/to/worktree");
			expect(state.base_branch).toBe("main");
		});

		test("should allow optional fields", () => {
			const state: AgentState = {
				branch: "feature/test-branch",
				task: "Test task",
				status: "completed",
				started_at: "2024-01-01T00:00:00.000Z",
				completed_at: "2024-01-01T01:00:00.000Z",
				worktree_path: "/path/to/worktree",
				base_branch: "main",
				error: "Some error occurred",
			};

			expect(state.completed_at).toBe("2024-01-01T01:00:00.000Z");
			expect(state.error).toBe("Some error occurred");
		});

		test("should support all valid status values", () => {
			const statuses: AgentStatus[] = [
				"pending",
				"running",
				"completed",
				"failed",
				"conflict",
				"merged",
			];

			for (const status of statuses) {
				const state: AgentState = {
					branch: "test",
					task: "test",
					status,
					started_at: new Date().toISOString(),
					worktree_path: "/test",
					base_branch: "main",
				};
				expect(state.status).toBe(status);
			}
		});
	});

	describe("writeAgentState", () => {
		test("should write agent state to YAML file", async () => {
			const state: AgentState = {
				branch: "feature/new-feature",
				task: "Add login functionality",
				status: "running",
				started_at: "2024-01-15T10:30:00.000Z",
				worktree_path: "/projects/worktree-feature",
				base_branch: "main",
			};

			await writeAgentState(state, tempDir);

			// Verify file was created
			const filePath = join(
				tempDir,
				".gitterflow",
				"agents",
				"feature-new-feature.yaml",
			);
			const file = Bun.file(filePath);
			expect(await file.exists()).toBe(true);

			// Verify content is valid YAML
			const content = await file.text();
			expect(content).toContain("branch: feature/new-feature");
			expect(content).toContain("task: Add login functionality");
			expect(content).toContain("status: running");
		});

		test("should create .gitterflow/agents directory if it does not exist", async () => {
			const state: AgentState = {
				branch: "test-branch",
				task: "Test task",
				status: "pending",
				started_at: "2024-01-15T10:30:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(state, tempDir);

			const agentsDir = join(tempDir, ".gitterflow", "agents");
			const dirExists = await Bun.file(
				join(agentsDir, "test-branch.yaml"),
			).exists();
			expect(dirExists).toBe(true);
		});

		test("should sanitize branch name with slashes for filename", async () => {
			const state: AgentState = {
				branch: "feature/user/auth",
				task: "Multi-level branch",
				status: "pending",
				started_at: "2024-01-15T10:30:00.000Z",
				worktree_path: "/test",
				base_branch: "develop",
			};

			await writeAgentState(state, tempDir);

			// Branch name slashes should be replaced with dashes in filename
			const filePath = join(
				tempDir,
				".gitterflow",
				"agents",
				"feature-user-auth.yaml",
			);
			expect(await Bun.file(filePath).exists()).toBe(true);
		});

		test("should overwrite existing state file", async () => {
			const state1: AgentState = {
				branch: "my-branch",
				task: "Initial task",
				status: "pending",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			const state2: AgentState = {
				branch: "my-branch",
				task: "Updated task",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(state1, tempDir);
			await writeAgentState(state2, tempDir);

			const filePath = join(tempDir, ".gitterflow", "agents", "my-branch.yaml");
			const content = await Bun.file(filePath).text();

			expect(content).toContain("task: Updated task");
			expect(content).toContain("status: running");
			expect(content).not.toContain("task: Initial task");
		});
	});

	describe("readAgentState", () => {
		test("should read agent state from YAML file", async () => {
			const originalState: AgentState = {
				branch: "feature/read-test",
				task: "Test reading state",
				status: "completed",
				started_at: "2024-01-15T10:00:00.000Z",
				completed_at: "2024-01-15T11:00:00.000Z",
				worktree_path: "/test/path",
				base_branch: "main",
			};

			await writeAgentState(originalState, tempDir);
			const readState = await readAgentState("feature/read-test", tempDir);

			expect(readState).not.toBeNull();
			expect(readState?.branch).toBe("feature/read-test");
			expect(readState?.task).toBe("Test reading state");
			expect(readState?.status).toBe("completed");
			expect(readState?.completed_at).toBe("2024-01-15T11:00:00.000Z");
		});

		test("should return null for non-existent branch", async () => {
			const state = await readAgentState("non-existent-branch", tempDir);
			expect(state).toBeNull();
		});

		test("should handle branch names with slashes", async () => {
			const originalState: AgentState = {
				branch: "feature/nested/branch",
				task: "Nested branch test",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(originalState, tempDir);
			const readState = await readAgentState("feature/nested/branch", tempDir);

			expect(readState?.branch).toBe("feature/nested/branch");
		});

		test("should read state with error field", async () => {
			const originalState: AgentState = {
				branch: "failed-branch",
				task: "Failed task",
				status: "failed",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
				error: "Build failed with exit code 1",
			};

			await writeAgentState(originalState, tempDir);
			const readState = await readAgentState("failed-branch", tempDir);

			expect(readState?.status).toBe("failed");
			expect(readState?.error).toBe("Build failed with exit code 1");
		});
	});

	describe("listAgentStates", () => {
		test("should return empty array when no states exist", async () => {
			const states = await listAgentStates(tempDir);
			expect(states).toEqual([]);
		});

		test("should list all agent states", async () => {
			const states: AgentState[] = [
				{
					branch: "feature/one",
					task: "Task one",
					status: "pending",
					started_at: "2024-01-15T10:00:00.000Z",
					worktree_path: "/test/one",
					base_branch: "main",
				},
				{
					branch: "feature/two",
					task: "Task two",
					status: "running",
					started_at: "2024-01-15T11:00:00.000Z",
					worktree_path: "/test/two",
					base_branch: "main",
				},
				{
					branch: "bugfix/three",
					task: "Task three",
					status: "completed",
					started_at: "2024-01-15T12:00:00.000Z",
					completed_at: "2024-01-15T13:00:00.000Z",
					worktree_path: "/test/three",
					base_branch: "develop",
				},
			];

			for (const state of states) {
				await writeAgentState(state, tempDir);
			}

			const listedStates = await listAgentStates(tempDir);

			expect(listedStates).toHaveLength(3);
			expect(listedStates.map((s) => s.branch).sort()).toEqual([
				"bugfix/three",
				"feature/one",
				"feature/two",
			]);
		});

		test("should return empty array when agents directory does not exist", async () => {
			const states = await listAgentStates(tempDir);
			expect(states).toEqual([]);
		});

		test("should filter by status when provided", async () => {
			const states: AgentState[] = [
				{
					branch: "branch-pending",
					task: "Pending task",
					status: "pending",
					started_at: "2024-01-15T10:00:00.000Z",
					worktree_path: "/test/pending",
					base_branch: "main",
				},
				{
					branch: "branch-running",
					task: "Running task",
					status: "running",
					started_at: "2024-01-15T11:00:00.000Z",
					worktree_path: "/test/running",
					base_branch: "main",
				},
				{
					branch: "branch-completed",
					task: "Completed task",
					status: "completed",
					started_at: "2024-01-15T12:00:00.000Z",
					worktree_path: "/test/completed",
					base_branch: "main",
				},
			];

			for (const state of states) {
				await writeAgentState(state, tempDir);
			}

			const runningStates = await listAgentStates(tempDir, {
				status: "running",
			});
			expect(runningStates).toHaveLength(1);
			expect(runningStates[0].branch).toBe("branch-running");

			const pendingStates = await listAgentStates(tempDir, {
				status: "pending",
			});
			expect(pendingStates).toHaveLength(1);
			expect(pendingStates[0].branch).toBe("branch-pending");
		});
	});

	describe("updateAgentStatus", () => {
		test("should update status of existing agent", async () => {
			const initialState: AgentState = {
				branch: "feature/update-test",
				task: "Test update",
				status: "pending",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(initialState, tempDir);
			await updateAgentStatus("feature/update-test", "running", tempDir);

			const updatedState = await readAgentState("feature/update-test", tempDir);
			expect(updatedState?.status).toBe("running");
			// Other fields should remain unchanged
			expect(updatedState?.task).toBe("Test update");
			expect(updatedState?.started_at).toBe("2024-01-15T10:00:00.000Z");
		});

		test("should set completed_at when status changes to completed", async () => {
			const initialState: AgentState = {
				branch: "feature/complete-test",
				task: "Test completion",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(initialState, tempDir);
			await updateAgentStatus("feature/complete-test", "completed", tempDir);

			const updatedState = await readAgentState(
				"feature/complete-test",
				tempDir,
			);
			expect(updatedState?.status).toBe("completed");
			expect(updatedState?.completed_at).toBeDefined();
		});

		test("should set completed_at when status changes to merged", async () => {
			const initialState: AgentState = {
				branch: "feature/merge-test",
				task: "Test merge",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(initialState, tempDir);
			await updateAgentStatus("feature/merge-test", "merged", tempDir);

			const updatedState = await readAgentState("feature/merge-test", tempDir);
			expect(updatedState?.status).toBe("merged");
			expect(updatedState?.completed_at).toBeDefined();
		});

		test("should add error message when provided", async () => {
			const initialState: AgentState = {
				branch: "feature/error-test",
				task: "Test error",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(initialState, tempDir);
			await updateAgentStatus("feature/error-test", "failed", tempDir, {
				error: "Build failed: missing dependency",
			});

			const updatedState = await readAgentState("feature/error-test", tempDir);
			expect(updatedState?.status).toBe("failed");
			expect(updatedState?.error).toBe("Build failed: missing dependency");
		});

		test("should throw error when agent state does not exist", async () => {
			await expect(
				updateAgentStatus("non-existent-branch", "running", tempDir),
			).rejects.toThrow();
		});

		test("should set completed_at when status changes to failed", async () => {
			const initialState: AgentState = {
				branch: "feature/fail-test",
				task: "Test failure",
				status: "running",
				started_at: "2024-01-15T10:00:00.000Z",
				worktree_path: "/test",
				base_branch: "main",
			};

			await writeAgentState(initialState, tempDir);
			await updateAgentStatus("feature/fail-test", "failed", tempDir);

			const updatedState = await readAgentState("feature/fail-test", tempDir);
			expect(updatedState?.status).toBe("failed");
			expect(updatedState?.completed_at).toBeDefined();
		});
	});
});
