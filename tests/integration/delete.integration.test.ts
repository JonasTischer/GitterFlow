import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { createTestRepo, listWorktrees, pathExists } from "./test-helpers";

/**
 * Integration Tests: delete command
 *
 * These tests verify the delete command works correctly with real git operations.
 * They test the full workflow: create worktree → delete worktree → verify cleanup.
 *
 * What we're testing:
 * 1. Can we delete a worktree that exists?
 * 2. Is the directory removed from disk?
 * 3. Is git's worktree tracking updated?
 * 4. Does it handle errors gracefully?
 */
describe("delete command (integration)", () => {
	/**
	 * Test: Delete an existing worktree
	 *
	 * Happy path: Create a worktree, then delete it.
	 * Verify:
	 * - Command succeeds
	 * - Directory is removed
	 * - Git no longer tracks it
	 */
	test("should delete an existing worktree", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "to-delete");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create a worktree first
			await $`cd ${repoPath} && bun ${cliPath} new to-delete`.quiet();

			// Verify it exists
			const existsBefore = await pathExists(worktreePath);
			expect(existsBefore).toBe(true);

			// Delete the worktree
			const result =
				await $`cd ${repoPath} && bun ${cliPath} delete to-delete`.quiet();

			// Verify command succeeded
			expect(result.exitCode).toBe(0);

			// Verify directory is removed
			const existsAfter = await pathExists(worktreePath);
			expect(existsAfter).toBe(false);

			// Verify git no longer tracks it (resolve path for comparison)
			const worktrees = await listWorktrees(repoPath);
			const resolvedWorktreePath = await $`realpath ${worktreePath}`
				.text()
				.then((p) => p.trim())
				.catch(() => worktreePath);
			expect(worktrees).not.toContain(resolvedWorktreePath);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Delete multiple worktrees
	 *
	 * Verify we can delete multiple worktrees independently
	 */
	test("should delete multiple worktrees independently", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create three worktrees
			await $`cd ${repoPath} && bun ${cliPath} new feature-1`.quiet();
			await $`cd ${repoPath} && bun ${cliPath} new feature-2`.quiet();
			await $`cd ${repoPath} && bun ${cliPath} new feature-3`.quiet();

			// Delete the middle one
			await $`cd ${repoPath} && bun ${cliPath} delete feature-2`.quiet();

			// Verify feature-2 is gone
			const feature2Path = join(parentDir, "feature-2");
			const feature2Exists = await pathExists(feature2Path);
			expect(feature2Exists).toBe(false);

			// Verify others still exist (resolve paths)
			const worktrees = await listWorktrees(repoPath);
			const resolved1 = await $`realpath ${join(parentDir, "feature-1")}`
				.text()
				.then((p) => p.trim());
			const resolved3 = await $`realpath ${join(parentDir, "feature-3")}`
				.text()
				.then((p) => p.trim());
			const resolved2 = await $`realpath ${feature2Path}`
				.text()
				.then((p) => p.trim())
				.catch(() => feature2Path);

			expect(worktrees).toContain(resolved1);
			expect(worktrees).toContain(resolved3);
			expect(worktrees).not.toContain(resolved2);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Error when worktree doesn't exist
	 *
	 * If user tries to delete a non-existent worktree, command should fail
	 * gracefully with a helpful error message.
	 */
	test("should fail gracefully when worktree doesn't exist", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const cliPath = join(process.cwd(), "src/index.ts");

			// Try to delete non-existent worktree
			try {
				await $`cd ${repoPath} && bun ${cliPath} delete nonexistent`;
				// Should not reach here
				expect(true).toBe(false);
			} catch (error) {
				// Command should fail
				const shellError = error as { exitCode?: number; stderr?: Buffer };
				expect(shellError.exitCode).toBe(1);

				// Should show helpful error message
				const stderr = shellError.stderr?.toString() ?? "";
				expect(stderr).toContain("Failed to remove worktree");
			}
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Delete worktree with slash in name
	 *
	 * Branch names like "feature/auth" should work correctly
	 */
	test("should delete worktree with slash in branch name", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "feature", "auth");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create worktree with slash in name
			await $`cd ${repoPath} && bun ${cliPath} new feature/auth`.quiet();

			// Verify it exists
			const existsBefore = await pathExists(worktreePath);
			expect(existsBefore).toBe(true);

			// Delete it
			await $`cd ${repoPath} && bun ${cliPath} delete feature/auth`.quiet();

			// Verify it's gone
			const existsAfter = await pathExists(worktreePath);
			expect(existsAfter).toBe(false);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Complete create → delete workflow
	 *
	 * This tests the full GitterFlow workflow:
	 * 1. Create a worktree
	 * 2. Do some work in it (make a commit)
	 * 3. Delete the worktree
	 * 4. Verify everything is cleaned up
	 */
	test("should handle complete create-work-delete workflow", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "workflow-test");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Step 1: Create worktree
			await $`cd ${repoPath} && bun ${cliPath} new workflow-test`.quiet();

			// Step 2: Do some work (create file and commit)
			await $`echo "test content" > ${worktreePath}/work.txt`.quiet();
			await $`git -C ${worktreePath} add work.txt`.quiet();
			await $`git -C ${worktreePath} commit -m "Add work"`.quiet();

			// Verify work was committed
			const commits = await $`git -C ${worktreePath} log --oneline`.text();
			expect(commits).toContain("Add work");

			// Step 3: Delete worktree (even though it has commits)
			await $`cd ${repoPath} && bun ${cliPath} delete workflow-test`.quiet();

			// Step 4: Verify cleanup
			const existsAfter = await pathExists(worktreePath);
			expect(existsAfter).toBe(false);

			// Note: The commits still exist in git (on the branch),
			// we just removed the worktree directory
			const branchExists =
				await $`git -C ${repoPath} branch --list workflow-test`.text();
			expect(branchExists).toContain("workflow-test");
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Verify command output messages
	 *
	 * Check that success messages are displayed correctly
	 */
	test("should display success message when deleting", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create worktree
			await $`cd ${repoPath} && bun ${cliPath} new test-output`.quiet();

			// Delete and capture output
			const result =
				await $`cd ${repoPath} && bun ${cliPath} delete test-output`;

			const stdout = result.stdout.toString();

			// Verify success message
			expect(stdout).toContain("Removed worktree");
			expect(stdout).toContain("test-output");
			expect(stdout).toContain("🗑"); // Trash emoji
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Delete all worktrees with --all flag
	 *
	 * Verify that --all flag deletes all worktrees except main repo
	 */
	test("should delete all worktrees with --all flag", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create multiple worktrees
			await $`cd ${repoPath} && bun ${cliPath} new all-test-1`.quiet();
			await $`cd ${repoPath} && bun ${cliPath} new all-test-2`.quiet();
			await $`cd ${repoPath} && bun ${cliPath} new all-test-3`.quiet();

			// Verify they exist
			const worktreesBefore = await listWorktrees(repoPath);
			expect(worktreesBefore.length).toBeGreaterThanOrEqual(3);

			// Delete all worktrees
			const result =
				await $`cd ${repoPath} && bun ${cliPath} delete --all`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify all worktrees are removed
			const worktreesAfter = await listWorktrees(repoPath);
			// Should only have main repo left
			expect(worktreesAfter.length).toBe(1);

			// Verify directories are gone
			const path1 = join(parentDir, "all-test-1");
			const path2 = join(parentDir, "all-test-2");
			const path3 = join(parentDir, "all-test-3");

			expect(await pathExists(path1)).toBe(false);
			expect(await pathExists(path2)).toBe(false);
			expect(await pathExists(path3)).toBe(false);
		} finally {
			await cleanup();
		}
	}, 15000);

	/**
	 * Test: --all flag should not delete main repo
	 *
	 * Verify that main repository worktree is excluded from deletion
	 */
	test("should not delete main repo when using --all", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create a worktree
			await $`cd ${repoPath} && bun ${cliPath} new temp-worktree`.quiet();

			// Delete all worktrees
			await $`cd ${repoPath} && bun ${cliPath} delete --all`.quiet();

			// Verify main repo still exists
			const mainRepoExists = await pathExists(repoPath);
			expect(mainRepoExists).toBe(true);

			// Verify main repo is still a valid git repo
			const gitStatus = await $`git -C ${repoPath} status`.quiet();
			expect(gitStatus.exitCode).toBe(0);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: --all with no worktrees
	 *
	 * When only main repo exists, should show message and exit successfully
	 */
	test("should handle --all when no worktrees exist", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const cliPath = join(process.cwd(), "src/index.ts");

			// Delete all (should find no worktrees to delete)
			const result =
				await $`cd ${repoPath} && bun ${cliPath} delete --all`;

			const stdout = result.stdout.toString();

			// Should show message about no worktrees
			expect(stdout).toContain("No worktrees to delete");
			expect(result.exitCode).toBe(0);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: --all flag output messages
	 *
	 * Verify that --all shows proper progress messages
	 */
	test("should display proper messages when using --all", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create worktrees
			await $`cd ${repoPath} && bun ${cliPath} new msg-test-1`.quiet();
			await $`cd ${repoPath} && bun ${cliPath} new msg-test-2`.quiet();

			// Delete all and capture output
			const result = await $`cd ${repoPath} && bun ${cliPath} delete --all`;

			const stdout = result.stdout.toString();

			// Should show list of worktrees to delete
			expect(stdout).toContain("Found");
			expect(stdout).toContain("worktree(s) to delete");

			// Should show deletion progress
			expect(stdout).toContain("Removed worktree");
			expect(stdout).toContain("msg-test-1");
			expect(stdout).toContain("msg-test-2");

			// Should show final count
			expect(stdout).toContain("Deleted 2 worktree(s)");
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: --all with -a short form
	 *
	 * Verify that -a works the same as --all
	 */
	test("should accept -a as short form for --all", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const cliPath = join(process.cwd(), "src/index.ts");

			// Create worktree
			await $`cd ${repoPath} && bun ${cliPath} new short-flag-test`.quiet();

			// Delete using -a flag
			const result = await $`cd ${repoPath} && bun ${cliPath} delete -a`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify worktree is deleted
			const worktreePath = join(parentDir, "short-flag-test");
			expect(await pathExists(worktreePath)).toBe(false);
		} finally {
			await cleanup();
		}
	}, 10000);
});
