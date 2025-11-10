import { createInterface } from "node:readline";
import { $ } from "bun";
import { resolve } from "node:path";
import { getSetting } from "../config";
import type { CommandDefinition } from "./types";

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
 * Commit any uncommitted changes (same logic as snap command)
 */
async function commitUncommittedChanges(
	run: typeof $,
	stdout: (msg: string) => void,
): Promise<boolean> {
	try {
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
			return true;
		}

		// Generate commit message using AI
		stdout("🤖 Generating commit message for uncommitted changes...");
		const commitMessage = await generateCommitMessage(diff);

		// Commit with the generated message
		await run`git commit -m ${commitMessage} --no-verify`;
		stdout(`✅ Committed changes: ${commitMessage}`);

		return true;
	} catch (error) {
		if (error instanceof Error) {
			if (error.message.includes("OPENROUTER_API_KEY")) {
				throw new Error(
					"OPENROUTER_API_KEY environment variable is not set. Cannot generate commit message.",
				);
			} else if (error.message.includes("OpenRouter API error")) {
				throw error;
			}
		}
		throw error;
	}
}

/**
 * Get current branch name
 */
async function getCurrentBranch(run: typeof $): Promise<string> {
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
		branch =
			typeof resolved === "string"
				? resolved.trim()
				: String(resolved).trim();
	}
	return branch;
}

/**
 * Detect base branch - try to find the branch from which this worktree was created
 * Falls back to config base_branch
 */
async function detectBaseBranch(
	run: typeof $,
	currentBranch: string,
	configBaseBranch: string,
): Promise<string> {
	try {
		// Try to find the merge base with common branches
		const commonBranches = [configBaseBranch, "main", "master", "develop"];

		for (const branch of commonBranches) {
			try {
				// Check if branch exists
				await run`git show-ref --verify --quiet refs/heads/${branch}`;
				// Check if current branch has this branch as an ancestor
				const mergeBase = run`git merge-base ${currentBranch} ${branch}`;
				let mergeBaseHash: string;
				if (
					typeof mergeBase === "object" &&
					mergeBase !== null &&
					"text" in mergeBase &&
					typeof mergeBase.text === "function"
				) {
					mergeBaseHash = (await mergeBase.text()).trim();
				} else {
					const resolved = await mergeBase;
					mergeBaseHash =
						typeof resolved === "string"
							? resolved.trim()
							: String(resolved).trim();
				}

				// Get the base branch commit
				const baseCommit = run`git rev-parse ${branch}`;
				let baseCommitHash: string;
				if (
					typeof baseCommit === "object" &&
					baseCommit !== null &&
					"text" in baseCommit &&
					typeof baseCommit.text === "function"
				) {
					baseCommitHash = (await baseCommit.text()).trim();
				} else {
					const resolved = await baseCommit;
					baseCommitHash =
						typeof resolved === "string"
							? resolved.trim()
							: String(resolved).trim();
				}

				// If merge base equals base branch commit, this is likely the base
				if (mergeBaseHash === baseCommitHash) {
					return branch;
				}
			} catch {
				// Branch doesn't exist or other error, try next
				continue;
			}
		}
	} catch {
		// Fall through to config default
	}

	// Fall back to config base branch
	return configBaseBranch;
}

/**
 * Check if a branch exists (local or remote)
 */
async function branchExists(
	run: typeof $,
	branch: string,
	remote = false,
): Promise<boolean> {
	try {
		if (remote) {
			await run`git show-ref --verify --quiet refs/remotes/origin/${branch}`;
		} else {
			await run`git show-ref --verify --quiet refs/heads/${branch}`;
		}
		return true;
	} catch {
		return false;
	}
}

export const finishCommand: CommandDefinition = {
	name: "finish",
	description:
		"Merge current branch into base branch, push changes, and optionally clean up",
	usage: "gitterflow finish",
	run: async ({ stderr, stdout, exec }) => {
		const run = exec ?? $;

		try {
			// Step 1: Get current branch and worktree path (before checkout)
			stdout("🔍 Detecting current branch...");
			const currentBranch = await getCurrentBranch(run);
			stdout(`   Current branch: ${currentBranch}`);

			// Store current directory (worktree path) before we checkout
			const currentWorktreePath = process.cwd();

			// Step 2: Detect base branch
			const configBaseBranch = getSetting("base_branch");
			stdout(`🔍 Detecting base branch (config: ${configBaseBranch})...`);
			const baseBranch = await detectBaseBranch(
				run,
				currentBranch,
				configBaseBranch,
			);
			stdout(`   Base branch: ${baseBranch}`);

			// Step 3: Commit any uncommitted changes
			stdout("\n📝 Checking for uncommitted changes...");
			await commitUncommittedChanges(run, stdout);

			// Step 4: Fetch latest changes
			stdout(`\n📥 Fetching latest changes from origin...`);
			await run`git fetch origin`;

			// Step 5: Try to checkout base branch
			// If we're in a worktree and base branch is checked out in main repo,
			// we need to handle this differently
			stdout(`\n🔀 Checking out base branch: ${baseBranch}`);
			let baseBranchCheckedOut = false;
			try {
				await run`git checkout ${baseBranch}`;
				baseBranchCheckedOut = true;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				// If base branch is already checked out elsewhere, we need a different approach
				if (
					errorMessage.includes("already checked out") ||
					errorMessage.includes("is already checked out")
				) {
					stderr(
						`\n⚠️  ${baseBranch} is already checked out elsewhere (likely in main repo).`,
					);
					stderr(
						`   Please run this command from the main repository directory, or`,
					);
					stderr(
						`   checkout ${baseBranch} in the main repo and run the merge manually.`,
					);
					stderr(`\n   Alternatively, you can:`);
					stderr(`   1. Push your current branch: git push origin ${currentBranch}`);
					stderr(`   2. Go to main repo and merge: git checkout ${baseBranch} && git merge ${currentBranch}`);
					stderr(`   3. Push: git push origin ${baseBranch}`);
					return 1;
				} else {
					throw error;
				}
			}

			// Step 6: Pull latest changes for base branch
			if (baseBranchCheckedOut) {
				stdout(`📥 Pulling latest changes for ${baseBranch}...`);
				try {
					await run`git pull origin ${baseBranch}`;
				} catch (error) {
					// If pull fails, it might be because the branch doesn't exist remotely yet
					// That's okay, we'll continue
					stdout(`   Note: Could not pull ${baseBranch} (may not exist remotely yet)`);
				}
			}

			// Step 7: Merge feature branch into base branch
			stdout(`\n🔀 Merging ${currentBranch} into ${baseBranch}...`);
			try {
				await run`git merge ${currentBranch} --no-edit`;
				stdout(`✅ Successfully merged ${currentBranch} into ${baseBranch}`);
			} catch (error) {
				// Check if it's a merge conflict
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				if (
					errorMessage.includes("conflict") ||
					errorMessage.includes("CONFLICT")
				) {
					stderr(
						`\n❌ Merge conflict detected — please resolve manually before continuing.`,
					);
					stderr(`   Current branch: ${currentBranch}`);
					stderr(`   Base branch: ${baseBranch}`);
					stderr(`   Resolve conflicts and then run: git commit`);
					return 1;
				}
				throw error;
			}

			// Step 8: Push updated base branch
			if (baseBranchCheckedOut) {
				stdout(`\n📤 Pushing ${baseBranch} to origin...`);
				await run`git push origin ${baseBranch}`;
				stdout(`✅ Pushed ${baseBranch} to origin`);
			}

			// Step 9: Cleanup options
			const deleteRemoteOnFinish = getSetting("delete_remote_on_finish");
			const worktreesDir = getSetting("worktrees_dir");

			stdout(`\n🧹 Cleanup options:`);
			stdout(`   Delete remote branch: ${deleteRemoteOnFinish ? "Yes" : "No"}`);

			// Check if remote branch exists
			const remoteBranchExists = await branchExists(run, currentBranch, true);
			if (remoteBranchExists && deleteRemoteOnFinish) {
				stdout(`   Deleting remote branch: origin/${currentBranch}`);
				try {
					await run`git push origin --delete ${currentBranch}`;
					stdout(`✅ Deleted remote branch: origin/${currentBranch}`);
				} catch (error) {
					stderr(
						`⚠️  Failed to delete remote branch: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}

			// Check if local branch exists (it should, but check anyway)
			const localBranchExists = await branchExists(run, currentBranch, false);
			if (localBranchExists) {
				stdout(`   Deleting local branch: ${currentBranch}`);
				await run`git branch -d ${currentBranch}`;
				stdout(`✅ Deleted local branch: ${currentBranch}`);
			}

			// Remove the worktree (we stored the path before checkout)
			// Try multiple approaches to find and remove the worktree
			stdout(`   Removing worktree for branch: ${currentBranch}`);
			let worktreeRemoved = false;

			// Try 1: Remove by relative path (common pattern: ../branch-name)
			try {
				await run`git worktree remove ../${currentBranch}`;
				stdout(`✅ Removed worktree: ../${currentBranch}`);
				worktreeRemoved = true;
			} catch {
				// Try 2: Remove by stored worktree path
				try {
					await run`git worktree remove ${currentWorktreePath}`;
					stdout(`✅ Removed worktree: ${currentWorktreePath}`);
					worktreeRemoved = true;
				} catch {
					// Try 3: Remove using worktrees_dir config
					try {
						const worktreesDir = getSetting("worktrees_dir");
						const worktreePath = resolve(worktreesDir, currentBranch);
						await run`git worktree remove ${worktreePath}`;
						stdout(`✅ Removed worktree: ${worktreePath}`);
						worktreeRemoved = true;
					} catch {
						// Worktree might already be removed or path differs
						if (!worktreeRemoved) {
							stdout(`   Note: Could not remove worktree (may have already been removed or path differs)`);
						}
					}
				}
			}

			// Success summary
			stdout(`\n✅ Successfully finished work on ${currentBranch}`);
			stdout(`   Merged into: ${baseBranch}`);
			stdout(`   Pushed to: origin/${baseBranch}`);

			return 0;
		} catch (error) {
			stderr(
				`❌ Failed to finish: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};

