import { $ } from "bun";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createTestRepo } from "./test-helpers";

describe("list command (integration)", () => {
	test("should list only base branch when there are no worktrees", async () => {
		const { repoPath, cleanup } = await createTestRepo();
		try {
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} list`.quiet();
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toContain("main");
		} finally {
			await cleanup();
		}
	});
	test("should list worktrees when there are some", async () => {
		const { repoPath, cleanup } = await createTestRepo();
		try {
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} start feature/new-feature`.quiet();
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} list`.quiet();
			expect(result.exitCode).toBe(0);
			expect(result.stdout.toString()).toContain("feature/new-feature");
		} finally {
			await cleanup();
		}
	});
});
