import { $ } from "bun";
import type { CommandDefinition } from "./types";

export const startCommand: CommandDefinition = {
	name: "start",
	description: "Create a git worktree for the specified branch",
	usage: "gitterflow start <branch>",
	run: async ({ args, stderr, stdout, exec }) => {
		const [branch] = args;

		if (!branch) {
			stderr("❌ Please provide a branch name");
			return 1;
		}

		const run = exec ?? $;
		await run`git worktree add ../${branch} ${branch}`;
		stdout(`✅ Created worktree for branch ${branch}`);
		return 0;
	},
};
