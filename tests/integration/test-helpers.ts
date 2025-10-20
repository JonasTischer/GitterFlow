import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

/**
 * Integration Test Helpers
 *
 * These utilities help create real Git repositories for integration testing.
 * Unlike unit tests that mock git commands, integration tests actually run
 * git operations to verify end-to-end behavior.
 */

/**
 * Creates a temporary Git repository for testing
 *
 * Usage:
 * ```typescript
 * const { repoPath, cleanup } = await createTestRepo();
 * try {
 *   // Run tests in repoPath
 * } finally {
 *   await cleanup();
 * }
 * ```
 *
 * @returns Object with repoPath and cleanup function
 */
export async function createTestRepo(): Promise<{
	repoPath: string;
	cleanup: () => Promise<void>;
}> {
	// Create unique temporary directory with timestamp to avoid conflicts
	const timestamp = Date.now();
	const random = Math.random().toString(36).substring(7);
	const testDir = await mkdtemp(
		join(tmpdir(), `gf-test-${timestamp}-${random}-`),
	);

	// Create the actual repo inside a subdirectory
	// This way worktrees go in testDir, not in shared /tmp
	const repoPath = join(testDir, "repo");
	await $`mkdir -p ${repoPath}`.quiet();

	try {
		// Initialize git repository with main as default branch
		await $`git -C ${repoPath} init -b main`.quiet();

		// Configure git (required for commits)
		await $`git -C ${repoPath} config user.name "GitterFlow Test"`.quiet();
		await $`git -C ${repoPath} config user.email "test@gitterflow.local"`.quiet();

		// Create initial commit (required for worktrees)
		await $`touch ${repoPath}/README.md`.quiet();
		await $`git -C ${repoPath} add README.md`.quiet();
		await $`git -C ${repoPath} commit -m "Initial commit"`.quiet();
	} catch (error) {
		// Clean up on failure (remove the entire test directory)
		await rm(testDir, { recursive: true, force: true });
		throw error;
	}

	// Return cleanup function
	const cleanup = async () => {
		try {
			// Remove all worktrees first (to avoid locks)
			const worktrees = await $`git -C ${repoPath} worktree list --porcelain`
				.text()
				.catch(() => "");

			const paths = worktrees
				.split("\n")
				.filter((line) => line.startsWith("worktree "))
				.map((line) => line.replace("worktree ", ""));

			// Filter out the main repo - check both original path and resolved path
			const resolvedRepoPath = await $`realpath ${repoPath}`
				.text()
				.then((p) => p.trim())
				.catch(() => repoPath);

			for (const path of paths) {
				const resolvedPath = await $`realpath ${path}`
					.text()
					.then((p) => p.trim())
					.catch(() => path);

				// Skip if this is the main repo (compare resolved paths)
				if (resolvedPath === resolvedRepoPath || path === repoPath) {
					continue;
				}

				await $`git -C ${repoPath} worktree remove --force ${path}`
					.quiet()
					.catch(() => {
						// Ignore errors - worktree might already be removed
					});
			}

			// Remove the entire test directory (includes repo + worktrees)
			await rm(testDir, { recursive: true, force: true });
		} catch (error) {
			console.error(`Failed to clean up test directory at ${testDir}:`, error);
			// Don't throw - cleanup should be best-effort
		}
	};

	return { repoPath, cleanup };
}

/**
 * Runs a command and captures stdout, stderr, and exit code
 *
 * This is useful for testing CLI commands end-to-end.
 *
 * @param command - Shell command to execute
 * @returns Object with stdout, stderr, and exitCode
 */
export async function runCommand(command: string): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number;
}> {
	try {
		const result = await $`sh -c ${command}`;
		return {
			stdout: result.stdout.toString(),
			stderr: result.stderr.toString(),
			exitCode: result.exitCode ?? 0,
		};
	} catch (error: unknown) {
		// Bun.$ throws on non-zero exit codes
		if (error && typeof error === "object") {
			const shellError = error as {
				exitCode?: number;
				stdout?: { toString(): string };
				stderr?: { toString(): string };
			};
			return {
				stdout: shellError.stdout?.toString() ?? "",
				stderr: shellError.stderr?.toString() ?? "",
				exitCode: shellError.exitCode ?? 1,
			};
		}
		throw error;
	}
}

/**
 * Checks if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await $`test -e ${path}`.quiet();
		return true;
	} catch {
		return false;
	}
}

/**
 * Gets the current git branch name
 */
export async function getCurrentBranch(repoPath: string): Promise<string> {
	const result = await $`git -C ${repoPath} branch --show-current`.text();
	return result.trim();
}

/**
 * Lists all git worktrees (returns resolved/canonical paths)
 */
export async function listWorktrees(repoPath: string): Promise<string[]> {
	try {
		const result = await $`git -C ${repoPath} worktree list --porcelain`.text();
		const paths = result
			.split("\n")
			.filter((line) => line.startsWith("worktree "))
			.map((line) => line.replace("worktree ", ""));

		// Resolve all paths to canonical form (handles /var vs /private/var on macOS)
		const resolved = await Promise.all(
			paths.map(async (path) => {
				try {
					return await $`realpath ${path}`.text().then((p) => p.trim());
				} catch {
					return path;
				}
			}),
		);

		return resolved;
	} catch {
		return [];
	}
}
