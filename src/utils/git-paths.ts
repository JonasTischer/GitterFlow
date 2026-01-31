import { resolve } from "node:path";
import { $ } from "bun";
import type { CommandExecutor } from "../commands/types";

/**
 * Get the main repository directory (where .git is located)
 * Works from both main repo and worktrees
 * 
 * When running from a worktree, this returns the main repo directory,
 * not the worktree directory. This is important for agent state files
 * which are stored in the main repo's .gitterflow/agents/ directory.
 */
export async function getMainRepoDir(
	run: CommandExecutor | typeof $ = $,
): Promise<string> {
	try {
		// First, try to get the common git directory
		// From a worktree, this will be something like /path/to/main/repo/.git/worktrees/worktree-name
		// From the main repo, this will be /path/to/main/repo/.git
		const commonDirResult = run`git rev-parse --git-common-dir`;
		let commonDir: string;
		if (
			typeof commonDirResult === "object" &&
			commonDirResult !== null &&
			"text" in commonDirResult &&
			typeof commonDirResult.text === "function"
		) {
			commonDir = (await commonDirResult.text()).trim();
		} else {
			const resolved = await commonDirResult;
			commonDir =
				typeof resolved === "string"
					? resolved.trim()
					: resolved !== null && resolved !== undefined
						? String(resolved).trim()
						: "";
		}

		const absoluteCommonDir = resolve(commonDir);

		// If we're in a worktree, common-dir is something like /path/to/repo/.git/worktrees/xyz
		// We need to go up to find the actual repo directory
		if (absoluteCommonDir.includes("/.git/worktrees/")) {
			// Extract the repo directory: /path/to/repo/.git/worktrees/xyz -> /path/to/repo
			const worktreesMatch = absoluteCommonDir.match(
				/^(.+?\/\.git)\/worktrees\/.+$/,
			);
			const gitDir = worktreesMatch?.[1];
			if (gitDir) {
				// Return the parent of .git directory (the main repo)
				return resolve(gitDir, "..");
			}
		}

		// If not a worktree, common-dir is just .git, so return parent (the main repo)
		return resolve(absoluteCommonDir, "..");
	} catch {
		// Fallback: try to get the root of the git repository
		try {
			const rootResult = run`git rev-parse --show-toplevel`;
			let root: string;
			if (
				typeof rootResult === "object" &&
				rootResult !== null &&
				"text" in rootResult &&
				typeof rootResult.text === "function"
			) {
				root = (await rootResult.text()).trim();
			} else {
				const resolved = await rootResult;
				root =
					typeof resolved === "string"
						? resolved.trim()
						: resolved !== null && resolved !== undefined
							? String(resolved).trim()
							: "";
			}
			
			// This might be a worktree directory, so we need to check
			const { readFileSync } = await import("node:fs");
			const gitFile = resolve(root, ".git");
			try {
				const gitContent = readFileSync(gitFile, "utf8").trim();
				// .git file in worktree contains: gitdir: /path/to/main/repo/.git/worktrees/worktree-name
				if (gitContent.startsWith("gitdir: ")) {
					const gitDirPath = gitContent.slice(8).trim();
					const absoluteGitDir = resolve(gitDirPath);
					if (absoluteGitDir.includes("/.git/worktrees/")) {
						const worktreesMatch = absoluteGitDir.match(
							/^(.+?\/\.git)\/worktrees\/.+$/,
						);
						const mainGitDir = worktreesMatch?.[1];
						if (mainGitDir) {
							return resolve(mainGitDir, "..");
						}
					}
				}
			} catch {
				// If we can't read .git file, assume root is the main repo
			}
			return resolve(root);
		} catch {
			// Last resort: use current directory
			return process.cwd();
		}
	}
}

/**
 * Get the root directory for agent state files
 * Uses provided rootDir if given (for testing), otherwise detects main repo
 */
export async function getAgentStateRootDir(
	rootDir?: string,
	run: CommandExecutor | typeof $ = $,
): Promise<string> {
	if (rootDir) {
		return rootDir;
	}
	try {
		return await getMainRepoDir(run);
	} catch {
		return process.cwd();
	}
}
