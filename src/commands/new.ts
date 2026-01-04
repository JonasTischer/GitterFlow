import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { preTrustWorktree } from "../utils/claude-trust";
import { createSymlinks } from "../utils/symlink";
import { spawnTerminal } from "../utils/terminal";
import type { CommandDefinition } from "./types";

/**
 * Parse --task flag from args
 * Returns { branch: string | undefined, task: string | undefined }
 */
function parseArgs(args: string[]): { branch?: string; task?: string } {
	let branch: string | undefined;
	let task: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--task" || arg === "-t") {
			// Next argument is the task
			task = args[i + 1];
			i++; // Skip the task value
		} else if (!arg.startsWith("-")) {
			// Non-flag argument is the branch name
			if (!branch) {
				branch = arg;
			}
		}
	}

	return { branch, task };
}

/**
 * Build the agent command with optional task
 * If task is provided, appends it as an initial prompt: claude "task"
 */
function buildAgentCommand(baseCommand: string, task?: string): string {
	if (!task) {
		return baseCommand;
	}

	// Escape double quotes in the task for shell safety
	const escapedTask = task.replace(/"/g, '\\"');

	// For claude, append the task as an initial prompt
	// claude "Your task: ..." starts claude with that prompt
	if (baseCommand === "claude" || baseCommand.startsWith("claude ")) {
		return `claude "${escapedTask}"`;
	}

	// For other agents, just append the task
	return `${baseCommand} "${escapedTask}"`;
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
	description:
		"Create a git worktree (optionally specify branch name and task)",
	usage: "gitterflow new [branch] [--task <prompt>]",
	run: async ({ args, stderr, stdout, exec }) => {
		// Parse arguments for branch name and optional --task flag
		const { branch, task } = parseArgs(args);

		// Generate random branch name if none provided or if empty/whitespace
		const trimmedBranch =
			branch && branch.trim() !== ""
				? branch.trim()
				: generateRandomBranchName();

		try {
			// Get the current branch (this will be the base branch for the new worktree)
			const run = exec ?? $;
			const currentBranchResult = run`git rev-parse --abbrev-ref HEAD`;

			// First await the result to handle Promises
			const awaitedResult = await currentBranchResult;

			let currentBranch: string;
			if (
				typeof awaitedResult === "object" &&
				awaitedResult !== null &&
				"text" in awaitedResult &&
				typeof awaitedResult.text === "function"
			) {
				currentBranch = (await awaitedResult.text()).trim();
			} else {
				currentBranch =
					typeof awaitedResult === "string"
						? awaitedResult.trim()
						: String(awaitedResult).trim();
			}

			// Use -b flag to create a new branch in the worktree
			// This creates the branch from current HEAD (base branch)
			// git worktree add -b <branch-name> <path>
			const worktreePath = `../${trimmedBranch}`;
			await run`git worktree add -b ${trimmedBranch} ${worktreePath}`;

			// Store the base branch information in git config for this branch
			// This allows finish command to know which branch to merge into
			await run`git config branch.${trimmedBranch}.gitterflow-base-branch ${currentBranch}`;

			// Resolve to absolute paths
			const absoluteWorktreePath = resolve(worktreePath);
			const absoluteMainRepoPath = process.cwd();

			// Create symlinks for configured files/directories
			const symlinkFiles = getSetting("symlink_files");
			if (symlinkFiles.length > 0) {
				createSymlinks(
					absoluteMainRepoPath,
					absoluteWorktreePath,
					symlinkFiles,
				);
			}

			// Pre-trust the worktree in Claude Code's config
			// This prevents the "Do you trust this folder?" dialog when opening the worktree
			try {
				await preTrustWorktree(absoluteWorktreePath);
			} catch {
				// If pre-trusting fails (e.g., no Claude config), continue anyway
				// User will just see the trust dialog once
			}

			// Output informative messages
			stdout(`✅ Created worktree for branch ${trimmedBranch}`);
			stdout(`📁 Switched to: ${absoluteWorktreePath}`);

			// Spawn a new terminal window/tab in the worktree directory and run coding agent
			// Skip terminal spawning in CI/test environments where it's not useful
			const skipTerminalSpawn =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (!skipTerminalSpawn) {
				try {
					const baseAgentCommand = getSetting("coding_agent");
					const agentCommand = buildAgentCommand(baseAgentCommand, task);
					const ide = getSetting("ide");
					const openTerminal = getSetting("open_terminal");

					spawnTerminal(absoluteWorktreePath, agentCommand);

					// Show appropriate messages based on what was opened
					const messages: string[] = [];
					if (ide) {
						messages.push(`🚀 Opened ${ide} in worktree directory`);
					}
					if (openTerminal) {
						messages.push(`🚀 Opened new terminal in worktree directory`);
					}
					if (messages.length > 0) {
						for (const msg of messages) {
							stdout(msg);
						}
						stdout(`🤖 Running coding agent: ${agentCommand}`);
					}
				} catch {
					// If spawning fails, fall back to outputting commands
					const baseAgentCommand = getSetting("coding_agent");
					const agentCommand = buildAgentCommand(baseAgentCommand, task);
					stdout(`cd ${absoluteWorktreePath}`);
					stdout(`${agentCommand}`);
					stderr(
						`⚠️  Could not open new terminal automatically. Run: cd ${absoluteWorktreePath} && ${agentCommand}`,
					);
				}
			} else {
				// In test/CI environment, just output the commands
				const baseAgentCommand = getSetting("coding_agent");
				const agentCommand = buildAgentCommand(baseAgentCommand, task);
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
