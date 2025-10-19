import type { CommandDefinition } from "./types";

export const HELP_MESSAGE = `
GitterFlow - Git Worktree Manager

Usage:
  gitterflow start <branch>   Create and check out a worktree
  gitterflow list             List all existing worktrees
  gitterflow delete <branch>  Remove a worktree
  gitterflow help             Show this help message

Examples:
  gitterflow start feature/new-feature
  gitterflow list
  gitterflow delete feature/new-feature
`.trim();

export const helpCommand: CommandDefinition = {
  name: "help",
  description: "Show usage information",
  usage: "gitterflow help",
  aliases: ["--help", "-h"],
  run: ({ stdout }) => {
    stdout(HELP_MESSAGE);
    return 0;
  },
};

