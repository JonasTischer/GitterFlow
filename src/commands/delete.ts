import { $ } from "bun";
import type { CommandDefinition } from "./types";

export const deleteCommand: CommandDefinition = {
  name: "delete",
  description: "Remove the worktree for the specified branch",
  usage: "gitterflow delete <branch>",
  aliases: ["remove"],
  run: async ({ args, stderr, stdout, exec }) => {
    const [branch] = args;

    if (!branch) {
      stderr("❌ Please provide a branch name to delete");
      return 1;
    }

    const run = exec ?? $;
    await run`git worktree remove ../${branch}`;
    stdout(`🗑 Removed worktree for branch ${branch}`);
    return 0;
  },
};
