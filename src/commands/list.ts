import { $ } from "bun";
import * as p from "@clack/prompts";
import { resolve } from "node:path";
import { getSetting } from "../config";
import { spawnTerminal } from "../utils/terminal";
import type { CommandDefinition } from "./types";

interface Worktree {
	path: string;
	branch: string;
	commit: string;
}

/**
 * Parse git worktree list output
 * Format: <path> <commit-hash> [<branch-name>]
 */
function parseWorktrees(output: string): Worktree[] {
	const lines = output
		.trim()
		.split("\n")
		.filter((line) => line.trim());
	const worktrees: Worktree[] = [];

	for (const line of lines) {
		// Parse format: /path/to/worktree commit-hash [branch-name]
		const match = line.match(/^(.+?)\s+([a-f0-9]+)\s+\[(.+?)\]$/);
		if (match) {
			const path = match[1];
			const commit = match[2];
			const branch = match[3];
			if (path && commit && branch) {
				worktrees.push({
					path: path.trim(),
					commit: commit.trim(),
					branch: branch.trim(),
				});
			}
		}
	}

	return worktrees;
}

export const listCommand: CommandDefinition = {
	name: "list",
	description: "List existing git worktrees",
	usage: "gitterflow list",
	run: async ({ stdout, stderr, exec }) => {
		const run = exec ?? $;

		try {
			// Get worktree list output
			// Use Bun's $ API to capture stdout
			const result = run`git worktree list`;
			let output: string;

			// Handle both real Bun $ API and mocked exec
			if (
				typeof result === "object" &&
				result !== null &&
				"text" in result &&
				typeof result.text === "function"
			) {
				output = await result.text();
			} else {
				const resolved = await result;
				output =
					typeof resolved === "string"
						? resolved
						: typeof resolved === "object" &&
								resolved !== null &&
								"text" in resolved &&
								typeof resolved.text === "function"
							? await resolved.text()
							: String(resolved);
			}

			if (!output.trim()) {
				stdout("No worktrees found.");
				return 0;
			}

			const worktrees = parseWorktrees(output);

			if (worktrees.length === 0) {
				stdout("No worktrees found.");
				return 0;
			}

			// Skip terminal spawning in CI/test environments
			const skipTerminalSpawn =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (skipTerminalSpawn) {
				// In test/CI environment, just output the list
				stdout(output);
				return 0;
			}

			// Create interactive selector
			const options = worktrees.map((wt) => ({
				value: wt.path,
				label: `${wt.branch} - ${wt.path}`,
			}));

			const selectedPath = await p.select({
				message: "Select a worktree to open:",
				options,
			});

			if (p.isCancel(selectedPath)) {
				p.cancel("Operation cancelled.");
				return 0;
			}

			// Open terminal in selected worktree
			try {
				const absolutePath = resolve(selectedPath);
				const agentCommand = getSetting("coding_agent");
				spawnTerminal(absolutePath);
				stdout(`🚀 Opened terminal in worktree: ${selectedPath}`);
				stdout(`🤖 Running coding agent: ${agentCommand}`);
			} catch (error) {
				stderr(
					`❌ Failed to open terminal: ${error instanceof Error ? error.message : String(error)}`,
				);
				return 1;
			}

			return 0;
		} catch (error) {
			stderr(
				`❌ Failed to list worktrees: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
