import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { spawnTerminal } from "../utils/terminal";
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

			// Resolve to absolute path
			const absoluteWorktreePath = resolve(worktreePath);

			// Output informative messages
			stdout(`✅ Created worktree for branch ${trimmedBranch}`);
			stdout(`📁 Switched to: ${absoluteWorktreePath}`);

			// Spawn a new terminal window/tab in the worktree directory and run coding agent
			// Skip terminal spawning in CI/test environments where it's not useful
			const skipTerminalSpawn =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (!skipTerminalSpawn) {
				try {
					const agentCommand = getSetting("coding_agent");
					const ide = getSetting("ide");
					const openTerminal = getSetting("open_terminal");

					spawnTerminal(absoluteWorktreePath);

					// Show appropriate messages based on what was opened
					const messages: string[] = [];
					if (ide) {
						messages.push(`🚀 Opened ${ide} in worktree directory`);
					}
					if (openTerminal) {
						messages.push(`🚀 Opened new terminal in worktree directory`);
					}
					if (messages.length > 0) {
						messages.forEach((msg) => stdout(msg));
						stdout(`🤖 Running coding agent: ${agentCommand}`);
					}
				} catch {
					// If spawning fails, fall back to outputting commands
					const agentCommand = getSetting("coding_agent");
					stdout(`cd ${absoluteWorktreePath}`);
					stdout(`${agentCommand}`);
					stderr(
						`⚠️  Could not open new terminal automatically. Run: cd ${absoluteWorktreePath} && ${agentCommand}`,
					);
				}
			} else {
				// In test/CI environment, just output the commands
				const agentCommand = getSetting("coding_agent");
				stdout(`cd ${absoluteWorktreePath}`);
				stdout(`${agentCommand}`);
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
