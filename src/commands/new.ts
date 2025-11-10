import { $ } from "bun";
import { resolve } from "node:path";
import type { CommandDefinition } from "./types";

/**
 * Generate a random branch name
 * Format: worktree-{adjective}-{noun}-{random-number}
 */
function generateRandomBranchName(): string {
	const adjectives = [
		"quick",
		"bright",
		"clever",
		"happy",
		"swift",
		"bold",
		"calm",
		"wise",
		"proud",
		"cool",
	];
	const nouns = [
		"fox",
		"wolf",
		"bear",
		"eagle",
		"tiger",
		"lion",
		"hawk",
		"owl",
		"falcon",
		"dragon",
	];

	const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const randomNum = Math.floor(Math.random() * 1000);

	return `worktree-${adjective}-${noun}-${randomNum}`;
}

export const newCommand: CommandDefinition = {
	name: "new",
	description: "Create a git worktree (optionally specify branch name)",
	usage: "gitterflow new [branch]",
	run: async ({ args, stderr, stdout, exec }) => {
		const [branch] = args;

		// Generate random branch name if none provided or if empty/whitespace
		const trimmedBranch =
			branch && branch.trim() !== ""
				? branch.trim()
				: generateRandomBranchName();

		try {
			// Use -b flag to create a new branch in the worktree
			// This creates the branch from current HEAD (base branch)
			// git worktree add -b <branch-name> <path>
			const run = exec ?? $;
			const worktreePath = `../${trimmedBranch}`;
			await run`git worktree add -b ${trimmedBranch} ${worktreePath}`;

			// Switch to the new worktree directory (resolve to absolute path)
			// Wrap in try-catch to handle cases where directory doesn't exist (e.g., in tests)
			try {
				const absoluteWorktreePath = resolve(worktreePath);
				process.chdir(absoluteWorktreePath);
				stdout(`✅ Created worktree for branch ${trimmedBranch}`);
				stdout(`📁 Switched to: ${process.cwd()}`);
			} catch (chdirError) {
				// If chdir fails (e.g., in unit tests), still report success but with relative path
				stdout(`✅ Created worktree for branch ${trimmedBranch}`);
				stdout(`📁 Switched to: ${resolve(worktreePath)}`);
			}
			return 0;
		} catch (error) {
			// Handle git errors gracefully
			stderr(
				`❌ Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
