import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Get the path to Claude Code's config file
 * Claude stores its configuration in ~/.claude.json
 */
export function getClaudeConfigPath(): string {
	return join(homedir(), ".claude.json");
}

interface ClaudeProjectConfig {
	hasTrustDialogAccepted?: boolean;
	allowedTools?: string[];
	[key: string]: unknown;
}

interface ClaudeConfig {
	projects?: Record<string, ClaudeProjectConfig>;
	[key: string]: unknown;
}

/**
 * Pre-trust a worktree directory in Claude Code's config
 *
 * This adds the worktree path to ~/.claude.json with hasTrustDialogAccepted: true,
 * which prevents Claude Code from showing the "Do you trust this folder?" dialog
 * when opening the worktree.
 *
 * @param worktreePath - Absolute path to the worktree directory
 * @param configPath - Optional custom config path (for testing)
 */
export async function preTrustWorktree(
	worktreePath: string,
	configPath?: string,
): Promise<void> {
	const claudeConfigPath = configPath ?? getClaudeConfigPath();

	// Read existing config or create empty one
	let config: ClaudeConfig = {};

	if (existsSync(claudeConfigPath)) {
		try {
			const content = await Bun.file(claudeConfigPath).text();
			config = JSON.parse(content);
		} catch {
			// If file is corrupted or unreadable, start fresh
			config = {};
		}
	}

	// Ensure projects object exists
	if (!config.projects) {
		config.projects = {};
	}

	// Add or update the worktree entry, preserving existing settings
	config.projects[worktreePath] = {
		...config.projects[worktreePath],
		hasTrustDialogAccepted: true,
	};

	// Write back to config file
	await Bun.write(claudeConfigPath, JSON.stringify(config, null, 2));
}
