import { $ } from "bun";
import type { CommandDefinition } from "./types";

export const startCommand: CommandDefinition = {
	name: "start",
	description: "Create a git worktree for the specified branch",
	usage: "gitterflow start <branch>",
	run: async ({ args, stderr, stdout, exec }) => {
		const [branch] = args;

		// Validate branch name
		if (!branch || branch.trim() === "") {
			stderr("❌ Please provide a branch name");
			return 1;
		}

		const trimmedBranch = branch.trim();

		try {
			// Use -b flag to create a new branch in the worktree
			// This creates the branch from current HEAD (base branch)
			// git worktree add -b <branch-name> <path>
			const run = exec ?? $;
			await run`git worktree add -b ${trimmedBranch} ../${trimmedBranch}`;
			stdout(`✅ Created worktree for branch ${trimmedBranch}`);
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
