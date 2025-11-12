import { resolve } from "node:path";
import { $ } from "bun";
import type { CommandDefinition, CommandExecutor } from "./types";

interface Worktree {
	path: string;
	branch: string;
	commit: string;
}

/**
 * Extract text from command result (handles both mock and real Bun.$ results)
 */
async function getCommandOutput(result: unknown): Promise<string> {
	const awaitedResult = await result;

	if (
		typeof awaitedResult === "object" &&
		awaitedResult !== null &&
		"text" in awaitedResult &&
		typeof awaitedResult.text === "function"
	) {
		return (await awaitedResult.text()).trim();
	}

	if (typeof awaitedResult === "string") {
		return awaitedResult.trim();
	}

	return String(awaitedResult).trim();
}

/**
 * Normalize path for comparison (resolve and remove trailing slash)
 */
function normalizePath(path: string): string {
	return resolve(path.trim()).replace(/\/$/, "");
}

/**
 * Format error message consistently
 */
function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Parse git worktree list output
 * Format: <path> <commit-hash> [<branch-name>]
 */
function parseWorktrees(output: string): Worktree[] {
	return output
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			// Match [branch-name] at the end
			const branchMatch = line.match(/\[(.+)\]$/);
			if (!branchMatch?.[1] || branchMatch.index === undefined) return null;

			const branch = branchMatch[1].trim();
			const withoutBranch = line.slice(0, branchMatch.index).trim();

			// Split by whitespace - last part is commit hash, rest is path
			const parts = withoutBranch.split(/\s+/);
			if (parts.length < 2) return null;

			const commit = parts[parts.length - 1];
			const path = parts.slice(0, -1).join(" ");

			// Validate commit hash format (hexadecimal)
			if (!commit || !/^[a-f0-9]+$/i.test(commit) || !path || !branch) {
				return null;
			}

			return {
				path: path.trim(),
				commit: commit.trim(),
				branch: branch.trim(),
			};
		})
		.filter((wt): wt is Worktree => wt !== null);
}

/**
 * Get the main repository directory (where .git is located)
 */
async function getMainRepoDir(
	run: CommandExecutor | typeof $,
): Promise<string> {
	try {
		const output = await getCommandOutput(run`git rev-parse --show-toplevel`);
		return resolve(output);
	} catch {
		return process.cwd();
	}
}

/**
 * Find a worktree by branch name
 */
async function findWorktree(
	run: CommandExecutor | typeof $,
	branchName: string,
): Promise<Worktree | null> {
	try {
		const output = await getCommandOutput(run`git worktree list`);
		const worktrees = parseWorktrees(output);
		return worktrees.find((wt) => wt.branch === branchName) ?? null;
	} catch {
		return null;
	}
}

/**
 * Delete all worktrees except the main repository
 */
async function deleteAllWorktrees(
	run: CommandExecutor | typeof $,
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
): Promise<number> {
	try {
		const output = await getCommandOutput(run`git worktree list`);

		if (!output) {
			stdout("No worktrees found.");
			return 0;
		}

		const worktrees = parseWorktrees(output);
		if (worktrees.length === 0) {
			stdout("No worktrees found.");
			return 0;
		}

		// Exclude main repository
		const mainRepoPath = normalizePath(await getMainRepoDir(run));
		const worktreesToDelete = worktrees.filter(
			(wt) => normalizePath(wt.path) !== mainRepoPath,
		);

		if (worktreesToDelete.length === 0) {
			stdout("No worktrees to delete (only main repository found).");
			return 0;
		}

		// Show what will be deleted
		stdout(`Found ${worktreesToDelete.length} worktree(s) to delete:`);
		for (const wt of worktreesToDelete) {
			stdout(`  - ${wt.branch} (${wt.path})`);
		}

		// Delete each worktree
		let successCount = 0;
		let failCount = 0;

		for (const wt of worktreesToDelete) {
			try {
				await run`git worktree remove ${wt.path}`;
				stdout(`✅ Removed worktree: ${wt.branch} (${wt.path})`);
				successCount++;
			} catch (error) {
				stderr(
					`❌ Failed to remove worktree ${wt.branch}: ${formatError(error)}`,
				);
				failCount++;
			}
		}

		stdout(`\n🗑 Deleted ${successCount} worktree(s)`);
		if (failCount > 0) {
			stderr(`⚠️  Failed to delete ${failCount} worktree(s)`);
			return 1;
		}

		return 0;
	} catch (error) {
		stderr(`❌ Failed to list worktrees: ${formatError(error)}`);
		return 1;
	}
}

/**
 * Delete a single worktree by branch name
 */
async function deleteSingleWorktree(
	run: CommandExecutor | typeof $,
	branchName: string,
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
): Promise<number> {
	try {
		// First try the common pattern: ../branch-name
		try {
			await run`git worktree remove ../${branchName}`;
			stdout(`🗑 Removed worktree for branch ${branchName}`);
			return 0;
		} catch {
			// Fall back to finding the exact path
			const worktree = await findWorktree(run, branchName);
			if (!worktree) {
				throw new Error(`Worktree for branch ${branchName} not found`);
			}

			await run`git worktree remove ${worktree.path}`;
			stdout(`🗑 Removed worktree for branch ${branchName}`);
			return 0;
		}
	} catch (error) {
		stderr(`❌ Failed to remove worktree: ${formatError(error)}`);
		return 1;
	}
}

export const deleteCommand: CommandDefinition = {
	name: "delete",
	description:
		"Remove the worktree for the specified branch, or all worktrees with --all",
	usage: "gitterflow delete <branch> | gitterflow delete --all",
	aliases: ["remove"],
	run: async ({ args, stderr, stdout, exec }) => {
		const run = exec ?? $;
		const hasAllFlag = args.includes("--all") || args.includes("-a");

		if (hasAllFlag) {
			return deleteAllWorktrees(run, stdout, stderr);
		}

		// Single branch deletion
		const branchArg = args.find((arg) => arg !== "--all" && arg !== "-a");
		if (!branchArg?.trim()) {
			stderr(
				"❌ Please provide a branch name to delete, or use --all to delete all worktrees",
			);
			return 1;
		}

		return deleteSingleWorktree(run, branchArg.trim(), stdout, stderr);
	},
};
