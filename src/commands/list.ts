import { $ } from "bun";
import type { CommandDefinition } from "./types";

export const listCommand: CommandDefinition = {
	name: "list",
	description: "List existing git worktrees",
	usage: "gitterflow list",
	run: async ({ exec }) => {
		const run = exec ?? $;
		await run`git worktree list`;
		return 0;
	},
};
