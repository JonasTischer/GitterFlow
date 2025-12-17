import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { createTestRepo } from "./test-helpers";

/**
 * Integration Tests: snap command
 *
 * These tests verify the snap command works correctly with real git repositories
 * and actual pre-commit hooks. Unlike unit tests that mock git operations,
 * these tests:
 *
 * - Create real temporary git repositories
 * - Set up actual pre-commit hooks (formatters, linters)
 * - Execute the snap command end-to-end
 * - Verify commits are created correctly
 *
 * Note: These tests use the -m flag to provide a custom commit message,
 * bypassing the AI generation to avoid API calls during CI.
 */

describe("snap command (integration)", () => {
	/**
	 * Test: Basic snap functionality
	 *
	 * Verifies that snap creates a commit with staged changes.
	 */
	test("should create a commit with staged changes", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Create a new file
			await $`echo "new content" > ${repoPath}/test.txt`.quiet();

			// Run snap command with -m to provide commit message (bypasses AI)
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} snap -m "feat: add new feature"`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify output
			const output = result.stdout.toString();
			expect(output).toContain("Commit created");

			// Verify commit was made
			const log = await $`git -C ${repoPath} log --oneline -1`.text();
			expect(log).toContain("feat: add new feature");

			// Verify working directory is clean
			const status = await $`git -C ${repoPath} status --porcelain`.text();
			expect(status.trim()).toBe("");
		} finally {
			await cleanup();
		}
	}, 15000);

	/**
	 * Test: Pre-commit hook that modifies files (formatter)
	 *
	 * Simulates a formatter hook that modifies files during commit.
	 * The snap command should detect this and amend the commit.
	 */
	test("should handle pre-commit hook that modifies files (formatter)", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Create a pre-commit hook that "formats" the file
			const hookPath = join(repoPath, ".git/hooks/pre-commit");
			await $`mkdir -p ${join(repoPath, ".git/hooks")}`.quiet();

			// Hook that adds a trailing newline (simulating a formatter)
			await Bun.write(
				hookPath,
				`#!/bin/sh
# Simulate a formatter that modifies files
if [ -f "test.txt" ]; then
  echo "" >> test.txt
fi
exit 0
`,
			);
			await $`chmod +x ${hookPath}`.quiet();

			// Create a file without trailing newline
			await $`printf "content without newline" > ${repoPath}/test.txt`.quiet();

			// Run snap command with -m (bypasses AI)
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} snap -m "feat: add formatted file"`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify output mentions amending
			const output = result.stdout.toString();
			expect(output).toContain("Commit created");

			// Verify working directory is clean (formatter changes were included)
			const status = await $`git -C ${repoPath} status --porcelain`.text();
			expect(status.trim()).toBe("");

			// Verify only one commit was made (the amend replaced the original)
			const commitCount =
				await $`git -C ${repoPath} rev-list --count HEAD`.text();
			expect(parseInt(commitCount.trim())).toBe(2); // Initial + our commit
		} finally {
			await cleanup();
		}
	}, 15000);

	/**
	 * Test: Pre-commit hook that fails
	 *
	 * When a pre-commit hook fails (e.g., lint errors), snap should
	 * show a helpful error message and leave changes staged.
	 */
	test("should show helpful message when pre-commit hook fails", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Create a pre-commit hook that always fails
			const hookPath = join(repoPath, ".git/hooks/pre-commit");
			await $`mkdir -p ${join(repoPath, ".git/hooks")}`.quiet();

			await Bun.write(
				hookPath,
				`#!/bin/sh
echo "Error: lint check failed"
exit 1
`,
			);
			await $`chmod +x ${hookPath}`.quiet();

			// Create a file to commit
			await $`echo "some content" > ${repoPath}/test.txt`.quiet();

			// Run snap command with -m - should fail due to hook
			let exitCode = 0;
			let stderr = "";
			try {
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} snap -m "feat: test commit"`;
			} catch (error) {
				const shellError = error as {
					exitCode?: number;
					stderr?: { toString(): string };
				};
				exitCode = shellError.exitCode ?? 1;
				stderr = shellError.stderr?.toString() ?? "";
			}

			expect(exitCode).toBe(1);

			// Verify helpful error message
			expect(stderr).toContain("Pre-commit hook failed");
			expect(stderr).toContain("staged");

			// Verify changes are still staged (ready to retry after fix)
			const status = await $`git -C ${repoPath} status --porcelain`.text();
			expect(status.trim()).not.toBe("");
		} finally {
			await cleanup();
		}
	}, 15000);

	/**
	 * Test: No changes to commit
	 *
	 * When there are no changes, snap should exit gracefully.
	 * Note: -m flag doesn't matter here since we exit before commit.
	 */
	test("should handle no changes gracefully", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Don't make any changes - repo is already clean

			// Run snap command with -m (bypasses AI, but won't matter since no changes)
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} snap -m "test"`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify output
			const output = result.stdout.toString();
			expect(output).toContain("No changes to commit");
		} finally {
			await cleanup();
		}
	}, 15000);

	/**
	 * Test: Snap with multiple modified files
	 *
	 * Verifies that snap handles multiple files correctly.
	 */
	test("should commit multiple modified files", async () => {
		const { repoPath, cleanup } = await createTestRepo();

		try {
			// Create multiple files
			await $`echo "file 1" > ${repoPath}/file1.txt`.quiet();
			await $`echo "file 2" > ${repoPath}/file2.txt`.quiet();
			await $`echo "file 3" > ${repoPath}/file3.txt`.quiet();

			// Run snap command with -m (bypasses AI)
			const result =
				await $`cd ${repoPath} && bun ${join(process.cwd(), "src/index.ts")} snap -m "feat: add multiple files"`.quiet();

			expect(result.exitCode).toBe(0);

			// Verify all files were committed
			const status = await $`git -C ${repoPath} status --porcelain`.text();
			expect(status.trim()).toBe("");

			// Verify files exist in the commit
			const files =
				await $`git -C ${repoPath} show --name-only --format="" HEAD`.text();
			expect(files).toContain("file1.txt");
			expect(files).toContain("file2.txt");
			expect(files).toContain("file3.txt");
		} finally {
			await cleanup();
		}
	}, 15000);
});
