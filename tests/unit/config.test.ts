import { describe, expect, test } from "bun:test";
import type { GitterflowConfig } from "../../src/config";

describe("GitterflowConfig", () => {
	test("should include symlink_files in config interface", () => {
		const config: GitterflowConfig = {
			base_branch: "main",
			worktrees_dir: "../worktrees",
			ai_model: "qwen/qwen3-235b-a22b-2507",
			open_terminal: true,
			delete_remote_on_finish: false,
			coding_agent: "claude",
			terminal: "iterm",
			ide: null,
			symlink_files: [".env", "node_modules"],
		};

		expect(config.symlink_files).toBeDefined();
		expect(Array.isArray(config.symlink_files)).toBe(true);
	});

	test("should allow empty symlink_files array", () => {
		const config: GitterflowConfig = {
			base_branch: "main",
			worktrees_dir: "../worktrees",
			ai_model: "qwen/qwen3-235b-a22b-2507",
			open_terminal: true,
			delete_remote_on_finish: false,
			coding_agent: "claude",
			terminal: "iterm",
			ide: null,
			symlink_files: [],
		};

		expect(config.symlink_files).toEqual([]);
	});
});
