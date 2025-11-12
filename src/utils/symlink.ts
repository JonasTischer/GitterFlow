import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * Create relative symlinks from main repo to worktree for specified files/directories
 * @param mainRepoPath - Absolute path to the main repository
 * @param worktreePath - Absolute path to the worktree
 * @param filesToLink - Array of file/directory names to symlink
 */
export function createSymlinks(
	mainRepoPath: string,
	worktreePath: string,
	filesToLink: string[],
): void {
	for (const file of filesToLink) {
		const sourceInMain = join(mainRepoPath, file);
		const targetInWorktree = join(worktreePath, file);

		// Skip if source doesn't exist in main repo
		if (!existsSync(sourceInMain)) {
			continue;
		}

		// Skip if target already exists in worktree (don't overwrite)
		if (existsSync(targetInWorktree)) {
			continue;
		}

		// Create parent directories if they don't exist in worktree
		const targetDir = dirname(targetInWorktree);
		if (!existsSync(targetDir)) {
			try {
				mkdirSync(targetDir, { recursive: true });
			} catch (error) {
				console.error(
					`Warning: Failed to create directory ${targetDir}: ${error instanceof Error ? error.message : String(error)}`,
				);
				continue;
			}
		}

		// Create relative symlink from worktree to main repo
		// The relative path must be calculated from the directory containing the symlink
		// (not from the worktree root) to the source file
		const relativePath = relative(targetDir, sourceInMain);

		try {
			symlinkSync(relativePath, targetInWorktree);
		} catch (error) {
			// Silently skip if symlink creation fails
			// (e.g., permission issues, filesystem doesn't support symlinks)
			console.error(
				`Warning: Failed to create symlink for ${file}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
