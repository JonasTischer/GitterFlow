import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	getClaudeConfigPath,
	preTrustWorktree,
} from "../../../src/utils/claude-trust";

describe("preTrustWorktree", () => {
	const testDir = join(import.meta.dir, "../../.tmp/claude-trust-test");
	const mockClaudeConfig = join(testDir, ".claude.json");

	beforeEach(() => {
		// Clean up and create test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("should add worktree to existing claude config with projects", async () => {
		// Create existing config with some projects
		const existingConfig = {
			numStartups: 10,
			projects: {
				"/Users/test/existing-project": {
					hasTrustDialogAccepted: true,
					allowedTools: ["Bash"],
				},
			},
		};
		writeFileSync(mockClaudeConfig, JSON.stringify(existingConfig, null, 2));

		const worktreePath = "/Users/test/new-worktree";
		await preTrustWorktree(worktreePath, mockClaudeConfig);

		// Read back and verify
		const updatedConfig = JSON.parse(await Bun.file(mockClaudeConfig).text());

		expect(updatedConfig.projects[worktreePath]).toBeDefined();
		expect(updatedConfig.projects[worktreePath].hasTrustDialogAccepted).toBe(
			true,
		);

		// Existing project should be preserved
		expect(
			updatedConfig.projects["/Users/test/existing-project"],
		).toBeDefined();
		expect(
			updatedConfig.projects["/Users/test/existing-project"]
				.hasTrustDialogAccepted,
		).toBe(true);

		// Other config should be preserved
		expect(updatedConfig.numStartups).toBe(10);
	});

	test("should create projects object if it doesn't exist", async () => {
		// Create config without projects
		const existingConfig = {
			numStartups: 5,
			autoUpdates: true,
		};
		writeFileSync(mockClaudeConfig, JSON.stringify(existingConfig, null, 2));

		const worktreePath = "/Users/test/new-worktree";
		await preTrustWorktree(worktreePath, mockClaudeConfig);

		const updatedConfig = JSON.parse(await Bun.file(mockClaudeConfig).text());

		expect(updatedConfig.projects).toBeDefined();
		expect(updatedConfig.projects[worktreePath].hasTrustDialogAccepted).toBe(
			true,
		);

		// Other config should be preserved
		expect(updatedConfig.numStartups).toBe(5);
		expect(updatedConfig.autoUpdates).toBe(true);
	});

	test("should create config file if it doesn't exist", async () => {
		const worktreePath = "/Users/test/new-worktree";
		await preTrustWorktree(worktreePath, mockClaudeConfig);

		expect(existsSync(mockClaudeConfig)).toBe(true);

		const config = JSON.parse(await Bun.file(mockClaudeConfig).text());
		expect(config.projects[worktreePath].hasTrustDialogAccepted).toBe(true);
	});

	test("should preserve existing project settings when updating", async () => {
		const worktreePath = "/Users/test/existing-worktree";

		// Create config with the same project but different settings
		const existingConfig = {
			projects: {
				[worktreePath]: {
					hasTrustDialogAccepted: false,
					allowedTools: ["Bash", "Read"],
					customSetting: "preserve-me",
				},
			},
		};
		writeFileSync(mockClaudeConfig, JSON.stringify(existingConfig, null, 2));

		await preTrustWorktree(worktreePath, mockClaudeConfig);

		const updatedConfig = JSON.parse(await Bun.file(mockClaudeConfig).text());

		// Trust should be updated to true
		expect(updatedConfig.projects[worktreePath].hasTrustDialogAccepted).toBe(
			true,
		);

		// Other settings should be preserved
		expect(updatedConfig.projects[worktreePath].allowedTools).toEqual([
			"Bash",
			"Read",
		]);
		expect(updatedConfig.projects[worktreePath].customSetting).toBe(
			"preserve-me",
		);
	});

	test("should handle multiple worktrees being added", async () => {
		const existingConfig = { projects: {} };
		writeFileSync(mockClaudeConfig, JSON.stringify(existingConfig, null, 2));

		await preTrustWorktree("/Users/test/worktree-1", mockClaudeConfig);
		await preTrustWorktree("/Users/test/worktree-2", mockClaudeConfig);
		await preTrustWorktree("/Users/test/worktree-3", mockClaudeConfig);

		const updatedConfig = JSON.parse(await Bun.file(mockClaudeConfig).text());

		expect(
			updatedConfig.projects["/Users/test/worktree-1"].hasTrustDialogAccepted,
		).toBe(true);
		expect(
			updatedConfig.projects["/Users/test/worktree-2"].hasTrustDialogAccepted,
		).toBe(true);
		expect(
			updatedConfig.projects["/Users/test/worktree-3"].hasTrustDialogAccepted,
		).toBe(true);
	});
});

describe("getClaudeConfigPath", () => {
	test("should return path to ~/.claude.json", () => {
		const configPath = getClaudeConfigPath();
		expect(configPath).toContain(".claude.json");
		expect(configPath).toContain(process.env.HOME || "");
	});
});
