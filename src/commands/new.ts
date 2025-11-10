import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform } from "node:os";
import { resolve } from "node:path";
import { $ } from "bun";
import type { CommandDefinition } from "./types";

type TerminalType =
	| "terminal"
	| "iterm"
	| "gnome-terminal"
	| "windows-terminal";

/**
 * Get the configured coding agent command from environment variable or config file
 * Defaults to "claude" if not configured
 */
function getCodingAgentCommand(): string {
	// Check environment variable first
	const envAgent =
		process.env.GITTERFLOW_AGENT ||
		process.env.GF_AGENT ||
		process.env.GITTERFLOW_CODING_AGENT ||
		process.env.GF_CODING_AGENT;
	if (envAgent) {
		return envAgent;
	}

	// Try to load from config file
	try {
		const configPath = resolve(".gitterflow.yaml");
		if (existsSync(configPath)) {
			const configContent = readFileSync(configPath, "utf-8");
			// Simple YAML parsing for codingAgent or agent field
			const codingAgentMatch = configContent.match(/^codingAgent:\s*(.+)$/m);
			const agentMatch = configContent.match(/^agent:\s*(.+)$/m);
			if (codingAgentMatch?.[1]) {
				return codingAgentMatch[1].trim();
			}
			if (agentMatch?.[1]) {
				return agentMatch[1].trim();
			}
		}
	} catch {
		// Ignore config file errors
	}

	// Default to "claude"
	return "claude";
}

/**
 * Get the configured terminal type from environment variable or config file
 * Falls back to auto-detection based on TERM_PROGRAM
 */
function getTerminalType(): TerminalType {
	const os = platform();

	// Check environment variable first
	const envTerminal =
		process.env.GITTERFLOW_TERMINAL || process.env.GF_TERMINAL;
	if (envTerminal) {
		return envTerminal.toLowerCase() as TerminalType;
	}

	// Try to load from config file
	try {
		const configPath = resolve(".gitterflow.yaml");
		if (existsSync(configPath)) {
			const configContent = readFileSync(configPath, "utf-8");
			// Simple YAML parsing for terminal field
			const terminalMatch = configContent.match(/^terminal:\s*(.+)$/m);
			if (terminalMatch?.[1]) {
				return terminalMatch[1].trim().toLowerCase() as TerminalType;
			}
		}
	} catch {
		// Ignore config file errors
	}

	// Auto-detect based on TERM_PROGRAM (macOS only)
	if (os === "darwin") {
		const termProgram = process.env.TERM_PROGRAM;
		if (termProgram === "iTerm.app" || process.env.ITERM_SESSION_ID) {
			return "iterm";
		}
		return "terminal"; // Default to Terminal.app
	}

	// Defaults for other platforms
	if (os === "linux") {
		return "gnome-terminal";
	}
	if (os === "win32") {
		return "windows-terminal";
	}

	return "terminal";
}

/**
 * Spawn a new terminal window/tab in the specified directory and run the coding agent
 * Supports configurable terminal types and coding agent commands
 */
function spawnTerminal(dir: string, agentCommand: string): void {
	const os = platform();
	const absolutePath = resolve(dir);
	const terminalType = getTerminalType();

	if (os === "darwin") {
		if (terminalType === "iterm") {
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
		if (terminalType === "gnome-terminal") {
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
		if (terminalType === "windows-terminal") {
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
					const agentCommand = getCodingAgentCommand();
					spawnTerminal(absoluteWorktreePath, agentCommand);
					stdout(`🚀 Opened new terminal in worktree directory`);
					stdout(`🤖 Running coding agent: ${agentCommand}`);
				} catch {
					// If spawning fails, fall back to outputting commands
					const agentCommand = getCodingAgentCommand();
					stdout(`cd ${absoluteWorktreePath}`);
					stdout(`${agentCommand}`);
					stderr(
						`⚠️  Could not open new terminal automatically. Run: cd ${absoluteWorktreePath} && ${agentCommand}`,
					);
				}
			} else {
				// In test/CI environment, just output the commands
				const agentCommand = getCodingAgentCommand();
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
