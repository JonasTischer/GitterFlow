import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import type {
	CommandContext,
	CommandDefinition,
	CommandExecutor,
} from "./types";

/**
 * Get the main repository directory (where .git is located)
 * Works from both main repo and worktrees
 */
async function getMainRepoDir(
	run: CommandExecutor | typeof $,
): Promise<string> {
	try {
		const commonDirResult = run`git rev-parse --git-common-dir`;
		let commonDir: string;
		if (
			typeof commonDirResult === "object" &&
			commonDirResult !== null &&
			"text" in commonDirResult &&
			typeof commonDirResult.text === "function"
		) {
			commonDir = (await commonDirResult.text()).trim();
		} else {
			const resolved = await commonDirResult;
			commonDir =
				typeof resolved === "string"
					? resolved.trim()
					: resolved !== null && resolved !== undefined
						? String(resolved).trim()
						: "";
		}

		const absoluteCommonDir = resolve(commonDir);

		if (absoluteCommonDir.includes("/.git/worktrees/")) {
			const worktreesMatch = absoluteCommonDir.match(
				/^(.+?\/\.git)\/worktrees\/.+$/,
			);
			const gitDir = worktreesMatch?.[1];
			if (gitDir) {
				return resolve(gitDir, "..");
			}
		}

		return resolve(absoluteCommonDir, "..");
	} catch {
		return process.cwd();
	}
}

/**
 * Get the configured OpenRouter model from environment variable or config file
 */
const _aiModel = getSetting("ai_model");

/**
 * Generate commit message from diff using OpenRouter API
 */
async function generateCommitMessage(diff: string): Promise<string> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error("OPENROUTER_API_KEY environment variable is not set");
	}

	const prompt = `You are a helpful assistant that writes concise, high-quality git commit messages.

Summarize the following diff into one short commit message (max 15 words).

Use the conventional commits style (e.g. 'feat:', 'fix:', 'refactor:').

Diff:
${diff}`;

	const model = _aiModel;

	const requestBody: {
		model: string;
		messages: Array<{ role: string; content: string }>;
		provider?: { sort: string };
	} = {
		model,
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
		provider: {
			sort: "throughput",
		},
	};

	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(requestBody),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	const message =
		data.choices?.[0]?.message?.content?.trim() || "chore: update code";

	return message;
}

/**
 * Get current branch name
 */
async function getCurrentBranch(
	run: CommandExecutor | typeof $,
): Promise<string> {
	const result = run`git rev-parse --abbrev-ref HEAD`;
	let branch: string;
	if (
		typeof result === "object" &&
		result !== null &&
		"text" in result &&
		typeof result.text === "function"
	) {
		branch = (await result.text()).trim();
	} else {
		const resolved = await result;
		if (
			typeof resolved === "object" &&
			resolved !== null &&
			"text" in resolved &&
			typeof resolved.text === "function"
		) {
			branch = (await resolved.text()).trim();
		} else {
			branch =
				typeof resolved === "string"
					? resolved.trim()
					: resolved !== null && resolved !== undefined
						? String(resolved).trim()
						: "";
		}
	}
	return branch;
}

/**
 * Commit any uncommitted changes with AI-generated message
 * Returns true if changes were committed, false if no changes
 */
async function commitUncommittedChanges(
	run: CommandExecutor | typeof $,
	stdout: (msg: string) => void,
): Promise<boolean> {
	// Stage all modified and deleted files
	await run`git add -A`;

	// Get the diff of staged changes
	const diffResult = run`git diff --cached`;
	let diff: string;
	if (
		typeof diffResult === "object" &&
		diffResult !== null &&
		"text" in diffResult &&
		typeof diffResult.text === "function"
	) {
		diff = await diffResult.text();
	} else {
		const resolved = await diffResult;
		diff =
			typeof resolved === "string"
				? resolved
				: typeof resolved === "object" &&
						resolved !== null &&
						"text" in resolved &&
						typeof resolved.text === "function"
					? await resolved.text()
					: String(resolved);
	}

	// Check if there are any changes
	if (!diff || diff.trim().length === 0) {
		stdout("No uncommitted changes to commit.");
		return false;
	}

	// Generate commit message using AI
	stdout("🤖 Generating commit message...");
	const commitMessage = await generateCommitMessage(diff);

	// Commit with the generated message (skip hooks to avoid issues)
	await run`git commit -m ${commitMessage} --no-verify`;
	stdout(`✅ Committed: ${commitMessage}`);

	return true;
}

/**
 * Extended context with optional rootDir for testing
 */
type ReadyCommandContext = CommandContext & {
	rootDir?: string;
};

/**
 * The `gf ready` command - marks work as ready for brain to merge.
 *
 * This command is for subagents to use instead of `gf finish`.
 * It commits changes but does NOT merge, leaving that for the brain agent.
 *
 * Key differences from `gf finish`:
 * - Commits changes: YES
 * - Merges to base: NO
 * - Deletes worktree: NO
 * - Handles conflicts: NO (brain handles this)
 */
export const readyCommand: CommandDefinition & {
	run: (context: ReadyCommandContext) => Promise<number>;
} = {
	name: "ready",
	description: "Mark work as ready for brain to merge (subagent use only)",
	usage: "gf ready",
	run: async ({ stderr, stdout, exec, rootDir }: ReadyCommandContext) => {
		const run = exec ?? $;

		// Determine the correct rootDir for agent state
		// When running from a worktree, we need to use the main repo directory
		let agentStateRootDir = rootDir;
		if (!agentStateRootDir) {
			try {
				agentStateRootDir = await getMainRepoDir(run);
			} catch {
				agentStateRootDir = process.cwd();
			}
		}

		try {
			// Step 1: Get current branch
			stdout("🔍 Detecting current branch...");
			const currentBranch = await getCurrentBranch(run);
			stdout(`   Branch: ${currentBranch}`);

			// Step 2: Check if we have an agent state
			const agentState = await readAgentState(currentBranch, agentStateRootDir);
			if (!agentState) {
				stderr(`⚠️  No agent state found for branch: ${currentBranch}`);
				stderr(`   The 'ready' command is meant for autonomous subagents.`);
				stderr(`   For manual worktrees, use 'gf finish' instead.`);
				return 1;
			}

			// Step 3: Verify current status allows transition to ready
			if (agentState.status === "ready") {
				stdout(`ℹ️  Already marked as ready. Waiting for brain to merge.`);
				return 0;
			}
			if (agentState.status === "merged") {
				stdout(`ℹ️  Already merged. Nothing to do.`);
				return 0;
			}

			// Step 4: Commit any uncommitted changes
			stdout("\n📝 Committing any uncommitted changes...");
			await commitUncommittedChanges(run, stdout);

			// Step 5: Update agent status to "ready"
			stdout("\n📋 Updating agent status to 'ready'...");
			await updateAgentStatus(currentBranch, "ready", agentStateRootDir);

			// Step 6: Success message
			stdout(`\n✅ Work marked as ready for merge`);
			stdout(`   Branch: ${currentBranch}`);
			stdout(`   Base: ${agentState.base_branch}`);
			stdout(
				`\n💡 The brain agent will handle merging into ${agentState.base_branch}.`,
			);
			stdout(`   You can exit now. Do NOT run 'gf finish'.`);

			return 0;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			stderr(`❌ Failed to mark ready: ${errorMessage}`);
			return 1;
		}
	},
};
