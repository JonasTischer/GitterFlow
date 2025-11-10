import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { $ } from "bun";
import type { CommandDefinition } from "./types";
import { getSetting } from "../config";

const _codingAgent = getSetting("coding_agent");
const _terminal = getSetting("terminal");
/**
 * Spawn a new terminal window/tab in the specified directory and run the coding agent
 * Supports configurable terminal types and coding agent commands
 */
function spawnTerminal(dir: string, agentCommand: string): void {
	const os = platform();
	const absolutePath = resolve(dir);
	if (os === "darwin") {
		if (_terminal === "iterm") {
			// iTerm2 - create new tab, cd to directory, and run agent command
			spawn("osascript", [
				"-e",
				'tell application "iTerm"',
				"-e",
				"tell current window",
				"-e",
				"create tab with default profile",
				"-e",
				"tell current session of current tab",
				"-e",
				`write text "cd '${absolutePath}' && ${agentCommand}"`,
				"-e",
				"end tell",
				"-e",
				"end tell",
				"-e",
				"end tell",
			]);
		} else {
			// Terminal.app (default) - cd to directory and run agent command
			const script = `tell application "Terminal"
         do script "cd '${absolutePath}' && ${agentCommand}"
         activate
       end tell`;
			spawn("osascript", ["-e", script]);
		}
	} else if (os === "linux") {
		if (_terminal === "gnome-terminal") {
			// GNOME Terminal - cd and run agent command
			spawn(
				"gnome-terminal",
				[
					"--working-directory",
					absolutePath,
					"--",
					"bash",
					"-c",
					`cd '${absolutePath}' && ${agentCommand}; exec bash`,
				],
				{ detached: true },
			);
		} else {
			// Fallback to gnome-terminal
			spawn(
				"gnome-terminal",
				[
					"--working-directory",
					absolutePath,
					"--",
					"bash",
					"-c",
					`cd '${absolutePath}' && ${agentCommand}; exec bash`,
				],
				{ detached: true },
			);
		}
	} else if (os === "win32") {
		if (_terminal === "windows-terminal") {
			// Windows Terminal - cd and run agent command
			spawn(
				"wt.exe",
				[
					"-w",
					"0",
					"powershell.exe",
					"-NoExit",
					`cd '${absolutePath}'; ${agentCommand}`,
				],
				{ detached: true },
			);
		} else {
			// Fallback to cmd - cd and run agent command
			spawn("cmd.exe", ["/k", `cd /d ${absolutePath} && ${agentCommand}`], {
				detached: true,
			});
		}
	} else {
		throw new Error(`Unsupported OS: ${os}`);
	}
}

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
					const agentCommand = _codingAgent;
					spawnTerminal(absoluteWorktreePath, agentCommand);
					stdout(`🚀 Opened new terminal in worktree directory`);
					stdout(`🤖 Running coding agent: ${agentCommand}`);
				} catch {
					// If spawning fails, fall back to outputting commands
					const agentCommand = _codingAgent;
					stdout(`cd ${absoluteWorktreePath}`);
					stdout(`${agentCommand}`);
					stderr(
						`⚠️  Could not open new terminal automatically. Run: cd ${absoluteWorktreePath} && ${agentCommand}`,
					);
				}
			} else {
				// In test/CI environment, just output the commands
				const agentCommand = _codingAgent;
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
