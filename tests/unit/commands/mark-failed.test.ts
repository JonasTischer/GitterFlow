import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { markFailedCommand } from "../../../src/commands/mark-failed";
import type { AgentState } from "../../../src/utils/agent-state";
import {
	readAgentState,
	writeAgentState,
} from "../../../src/utils/agent-state";
import { commandIO } from "../test-helpers";

describe("mark-failed command", () => {
	const testDir = join(import.meta.dir, ".test-mark-failed-tmp");

	beforeEach(async () => {
		await mkdir(testDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	// Helper to create a mock exec that returns the current branch
	const createMockExec = (currentBranch: string) => {
		return async (strings: TemplateStringsArray, ..._values: unknown[]) => {
			const command = strings.join("");

			// Mock git rev-parse --abbrev-ref HEAD
			if (command.includes("git rev-parse --abbrev-ref HEAD")) {
				return { text: async () => currentBranch };
			}

			return {};
		};
	};

	test("should update agent state to 'failed'", async () => {
		const { io } = commandIO();

		// Setup: create initial agent state
		const initialState: AgentState = {
			branch: "feature-mark-failed",
			task: "Test mark failed",
			status: "running",
			started_at: "2024-01-15T10:00:00.000Z",
			worktree_path: "/path/to/worktree",
			base_branch: "main",
		};
		await writeAgentState(initialState, testDir);

		// Execute: run mark-failed command
		const exitCode = await markFailedCommand.run({
			args: [],
			...io,
			exec: createMockExec("feature-mark-failed"),
			rootDir: testDir,
		});

		expect(exitCode).toBe(0);

		// Verify: agent state should be updated to failed
		const state = await readAgentState("feature-mark-failed", testDir);
		expect(state?.status).toBe("failed");
		expect(state?.completed_at).toBeDefined();
	});

	test("should store error message when provided", async () => {
		const { io } = commandIO();

		// Setup: create initial agent state
		const initialState: AgentState = {
			branch: "feature-with-error",
			task: "Test with error message",
			status: "running",
			started_at: "2024-01-15T10:00:00.000Z",
			worktree_path: "/path/to/worktree",
			base_branch: "main",
		};
		await writeAgentState(initialState, testDir);

		// Execute: run mark-failed command with error message
		const exitCode = await markFailedCommand.run({
			args: ["--error", "Build failed: TypeScript compilation error"],
			...io,
			exec: createMockExec("feature-with-error"),
			rootDir: testDir,
		});

		expect(exitCode).toBe(0);

		// Verify: agent state should have error message
		const state = await readAgentState("feature-with-error", testDir);
		expect(state?.status).toBe("failed");
		expect(state?.error).toBe("Build failed: TypeScript compilation error");
	});

	test("should work without error message", async () => {
		const { io, stdoutMessages } = commandIO();

		// Setup: create initial agent state
		const initialState: AgentState = {
			branch: "feature-no-error-msg",
			task: "Test without error message",
			status: "running",
			started_at: "2024-01-15T10:00:00.000Z",
			worktree_path: "/path/to/worktree",
			base_branch: "main",
		};
		await writeAgentState(initialState, testDir);

		// Execute: run mark-failed command without error message
		const exitCode = await markFailedCommand.run({
			args: [],
			...io,
			exec: createMockExec("feature-no-error-msg"),
			rootDir: testDir,
		});

		expect(exitCode).toBe(0);

		// Verify: agent state should be failed without error field
		const state = await readAgentState("feature-no-error-msg", testDir);
		expect(state?.status).toBe("failed");
		expect(state?.error).toBeUndefined();

		// Verify: output should indicate success
		expect(stdoutMessages.join("\n")).toContain("marked as failed");
	});

	test("should fail gracefully if no agent state exists", async () => {
		const { io, stderrMessages } = commandIO();

		// No agent state created

		// Execute: run mark-failed command
		const exitCode = await markFailedCommand.run({
			args: [],
			...io,
			exec: createMockExec("feature-no-state"),
			rootDir: testDir,
		});

		expect(exitCode).toBe(1);

		// Verify: error message should indicate no agent state
		expect(stderrMessages.join("\n")).toContain("No agent state found");
	});

	test("should preserve other agent state fields when marking as failed", async () => {
		const { io } = commandIO();

		// Setup: create initial agent state with all fields
		const initialState: AgentState = {
			branch: "feature-preserve-fields",
			task: "Test preserve fields on failure",
			status: "running",
			started_at: "2024-01-15T10:30:00.000Z",
			worktree_path: "/specific/path/to/worktree",
			base_branch: "develop",
			message: "Working on implementation",
		};
		await writeAgentState(initialState, testDir);

		// Execute: run mark-failed command with error
		await markFailedCommand.run({
			args: ["--error", "Test failure"],
			...io,
			exec: createMockExec("feature-preserve-fields"),
			rootDir: testDir,
		});

		// Verify: other fields should be preserved
		const state = await readAgentState("feature-preserve-fields", testDir);
		expect(state?.status).toBe("failed");
		expect(state?.task).toBe("Test preserve fields on failure");
		expect(state?.started_at).toBe("2024-01-15T10:30:00.000Z");
		expect(state?.worktree_path).toBe("/specific/path/to/worktree");
		expect(state?.base_branch).toBe("develop");
		expect(state?.message).toBe("Working on implementation");
		expect(state?.error).toBe("Test failure");
		expect(state?.completed_at).toBeDefined();
	});

	test("should handle -e shorthand for --error", async () => {
		const { io } = commandIO();

		// Setup: create initial agent state
		const initialState: AgentState = {
			branch: "feature-shorthand",
			task: "Test shorthand flag",
			status: "running",
			started_at: "2024-01-15T10:00:00.000Z",
			worktree_path: "/path/to/worktree",
			base_branch: "main",
		};
		await writeAgentState(initialState, testDir);

		// Execute: run mark-failed command with -e shorthand
		const exitCode = await markFailedCommand.run({
			args: ["-e", "Shorthand error message"],
			...io,
			exec: createMockExec("feature-shorthand"),
			rootDir: testDir,
		});

		expect(exitCode).toBe(0);

		// Verify: agent state should have error message
		const state = await readAgentState("feature-shorthand", testDir);
		expect(state?.status).toBe("failed");
		expect(state?.error).toBe("Shorthand error message");
	});
});
