import { $ } from "bun";
import type { CommandDefinition } from "./types";

export const deleteCommand: CommandDefinition = {
	name: "delete",
	description: "Remove the worktree for the specified branch",
	usage: "gitterflow delete <branch>",
	aliases: ["remove"],
	run: async ({ args, stderr, stdout, exec }) => {
		const [branch] = args;

		// Validate branch name
		if (!branch || branch.trim() === "") {
			stderr("❌ Please provide a branch name to delete");
			return 1;
		}

		const trimmedBranch = branch.trim();

		try {
			// Remove the git worktree
			const run = exec ?? $;
			await run`git worktree remove ../${trimmedBranch}`;
			stdout(`🗑 Removed worktree for branch ${trimmedBranch}`);
			return 0;
		} catch (error) {
			// Handle git errors gracefully
			stderr(
				`❌ Failed to remove worktree: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
