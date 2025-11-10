import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import {
	createTestRepo,
	getCurrentBranch,
	listWorktrees,
	pathExists,
} from "./test-helpers";

/**
 * Integration Tests: new command
 *
 * These tests actually run git commands to verify the new command works
 * correctly in real-world scenarios. Unlike unit tests that mock git,
 * these tests:
 *
 * - Create real temporary git repositories
 * - Execute actual git worktree commands
 * - Verify file system changes
 * - Test the full end-to-end workflow
 *
 * Running these tests:
 * - They're slower than unit tests (file I/O, git operations)
 * - Each test creates and cleans up a temporary repo
 * - Tests are isolated from each other
 *
 * What we're testing:
 * 1. Can we create a worktree from the CLI?
 * 2. Does the worktree exist at the right path?
 * 3. Is the new branch created?
 * 4. Is git state correct after creation?
 */
describe("new command (integration)", () => {
	/**
	 * Test: Basic worktree creation
	 *
	 * This is the core happy-path test. We want to verify that:
	 * 1. The command succeeds (exit code 0)
	 * 2. A new directory is created at ../branch-name
	 * 3. A new git branch is created
	 * 4. The worktree is registered with git
	 */
	test("should create a new worktree with real git", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Get parent directory (where worktrees will be created)
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "test-feature");

			// Run the actual command from within the repo
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new test-feature`.quiet();

			// Verify command succeeded
			expect(result.exitCode).toBe(0);

			// Verify output includes switch message and cd command
			const output = result.stdout.toString();
			expect(output).toContain("Created worktree");
			expect(output).toContain("Switched to");
			expect(output).toContain("cd ");

			// Verify worktree directory was created
			const exists = await pathExists(worktreePath);
			expect(exists).toBe(true);

			// Verify git recognizes the worktree (resolve path for comparison)
			const worktrees = await listWorktrees(repoPath);
			const resolvedWorktreePath = await $`realpath ${worktreePath}`
				.text()
				.then((p) => p.trim());
			expect(worktrees).toContain(resolvedWorktreePath);

			// Verify the new branch exists
			const branches =
				await $`git -C ${repoPath} branch --list test-feature`.text();
			expect(branches).toContain("test-feature");

			// Verify we can navigate to the worktree
			const branchInWorktree = await getCurrentBranch(worktreePath);
			expect(branchInWorktree).toBe("test-feature");
		} finally {
			await cleanup();
		}
	}, 10000); // 10 second timeout for file I/O

	/**
	 * Test: Branch name with slashes
	 *
	 * Git conventions often use slashes (feature/auth, bugfix/login).
	 * This tests that our command handles these correctly.
	 */
	test("should handle branch names with slashes", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "feature", "authentication");

			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new feature/authentication`.quiet();

			// Verify worktree created (note: git creates nested directories)
			const exists = await pathExists(worktreePath);
			expect(exists).toBe(true);

			// Verify output includes switch message and cd command
			const output = result.stdout.toString();
			expect(output).toContain("Switched to");
			expect(output).toContain("cd ");

			// Verify branch name is correct (with slash)
			const branch = await getCurrentBranch(worktreePath);
			expect(branch).toBe("feature/authentication");
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Multiple worktrees from same base
	 *
	 * A key GitterFlow use case: create multiple worktrees to run
	 * multiple AI agents in parallel. Each should be independent.
	 */
	test("should allow creating multiple worktrees", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");

			// Create first worktree
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new feature-1`.quiet();

			// Create second worktree
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new feature-2`.quiet();

			// Create third worktree
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new feature-3`.quiet();

			// Verify all three exist (resolve paths for comparison)
			const worktrees = await listWorktrees(repoPath);
			const resolved1 = await $`realpath ${join(parentDir, "feature-1")}`
				.text()
				.then((p) => p.trim());
			const resolved2 = await $`realpath ${join(parentDir, "feature-2")}`
				.text()
				.then((p) => p.trim());
			const resolved3 = await $`realpath ${join(parentDir, "feature-3")}`
				.text()
				.then((p) => p.trim());

			expect(worktrees).toContain(resolved1);
			expect(worktrees).toContain(resolved2);
			expect(worktrees).toContain(resolved3);
			expect(worktrees).toHaveLength(4); // 3 worktrees + main repo
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Error when branch already exists
	 *
	 * If user tries to create a worktree for a branch that already exists,
	 * git should fail and we should handle it gracefully.
	 */
	test("should fail gracefully if branch already exists", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Create worktree first time - should succeed
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new duplicate-branch`.quiet();

			// Try to create same branch again - should fail
			try {
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new duplicate-branch`;
				// Should not reach here
				expect(true).toBe(false); // Force failure if command succeeds
			} catch (error) {
				// Command should fail with exit code 1
				const shellError = error as { exitCode?: number };
				expect(shellError.exitCode).toBe(1);
			}
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Worktree inherits from current branch
	 *
	 * When creating a worktree, it should be based on the current branch (HEAD).
	 * This test verifies the new worktree has the same commit as the base.
	 */
	test("should create worktree from current branch", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Get commit hash of main branch
			const mainCommit = await $`git -C ${repoPath} rev-parse HEAD`
				.text()
				.then((s) => s.trim());

			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "new-feature");

			// Create worktree
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new new-feature`.quiet();

			// Get commit hash of new worktree
			const worktreeCommit = await $`git -C ${worktreePath} rev-parse HEAD`
				.text()
				.then((s) => s.trim());

			// Should start from the same commit
			expect(worktreeCommit).toBe(mainCommit);
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Worktree is independent
	 *
	 * Changes in a worktree shouldn't affect the main repo (yet).
	 * This tests that worktrees are truly isolated.
	 */
	test("should create independent worktree", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");
			const worktreePath = join(parentDir, "isolated-feature");

			// Create worktree
			await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new isolated-feature`.quiet();

			// Make a change in the worktree
			await $`echo "worktree change" > ${worktreePath}/test.txt`.quiet();
			await $`git -C ${worktreePath} add test.txt`.quiet();
			await $`git -C ${worktreePath} commit -m "Add test file"`.quiet();

			// Verify main repo doesn't have this file
			const fileInMain = await pathExists(join(repoPath, "test.txt"));
			expect(fileInMain).toBe(false);

			// Verify main branch is still on original commit
			const mainBranch = await getCurrentBranch(repoPath);
			expect(mainBranch).toBe("main");
		} finally {
			await cleanup();
		}
	}, 10000);

	/**
	 * Test: Optional branch name with random generation
	 *
	 * When no branch name is provided, the command should generate
	 * a random name and create a worktree with it.
	 */
	test("should create worktree with random name when no branch provided", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			const parentDir = join(repoPath, "..");

			// Run command without branch name
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} new`.quiet();

			// Command should succeed
			expect(result.exitCode).toBe(0);

			// Verify output includes switch message and cd command
			const output = result.stdout.toString();
			expect(output).toContain("Switched to");
			expect(output).toContain("cd ");

			// Should have created a worktree (verify we have more than just main repo)
			const worktrees = await listWorktrees(repoPath);
			expect(worktrees.length).toBeGreaterThan(1);

			// Find the new worktree path (not the main repo)
			const newWorktree = worktrees.find((path) => !path.endsWith(repoPath));
			expect(newWorktree).toBeDefined();
		} finally {
			await cleanup();
		}
	}, 10000);
});
