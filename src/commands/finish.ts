import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import { notify } from "../utils/notifications";
import type {
	CommandContext,
	CommandDefinition,
	CommandExecutor,
} from "./types";

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
	run: CommandExecutor | typeof $,
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
 * Detect base branch - first check git config for stored base branch,
 * then try to find the branch from which this worktree was created,
 * finally falls back to config base_branch
 */
async function detectBaseBranch(
	run: CommandExecutor | typeof $,
	currentBranch: string,
	configBaseBranch: string,
): Promise<string> {
	// First, check if we stored the base branch in git config
	try {
		const storedBaseResult = run`git config branch.${currentBranch}.gitterflow-base-branch`;
		let storedBase: string;
		if (
			typeof storedBaseResult === "object" &&
			storedBaseResult !== null &&
			"text" in storedBaseResult &&
			typeof storedBaseResult.text === "function"
		) {
			storedBase = (await storedBaseResult.text()).trim();
		} else {
			const resolved = await storedBaseResult;
			if (
				typeof resolved === "object" &&
				resolved !== null &&
				"text" in resolved &&
				typeof resolved.text === "function"
			) {
				storedBase = (await resolved.text()).trim();
			} else {
				storedBase =
					typeof resolved === "string"
						? resolved.trim()
						: resolved !== null && resolved !== undefined
							? String(resolved).trim()
							: "";
			}
		}

		// Verify the stored base branch still exists
		if (storedBase && storedBase.length > 0) {
			try {
				await run`git show-ref --verify --quiet refs/heads/${storedBase}`;
				return storedBase;
			} catch {
				// Stored base branch doesn't exist anymore, continue to detection
			}
		}
	} catch {
		// No stored base branch, continue to detection
	}

	// Fallback: Try to find the merge base with common branches
	try {
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
							: resolved !== null && resolved !== undefined
								? String(resolved).trim()
								: "";
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
							: resolved !== null && resolved !== undefined
								? String(resolved).trim()
								: "";
				}

				// If merge base equals base branch commit, this is likely the base
				if (mergeBaseHash === baseCommitHash) {
					return branch;
				}
			} catch {}
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
	run: CommandExecutor | typeof $,
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

/**
 * Check if a directory has uncommitted changes using git status --porcelain
 */
async function hasUncommittedChanges(
	run: CommandExecutor | typeof $,
): Promise<boolean> {
	try {
		const result = run`git status --porcelain`;
		let status: string;
		if (
			typeof result === "object" &&
			result !== null &&
			"text" in result &&
			typeof result.text === "function"
		) {
			status = (await result.text()).trim();
		} else {
			const resolved = await result;
			if (
				typeof resolved === "object" &&
				resolved !== null &&
				"text" in resolved &&
				typeof resolved.text === "function"
			) {
				status = (await resolved.text()).trim();
			} else {
				status =
					typeof resolved === "string"
						? resolved.trim()
						: resolved !== null && resolved !== undefined
							? String(resolved).trim()
							: "";
			}
		}
		return status.length > 0;
	} catch {
		return false;
	}
}

/**
 * Stash uncommitted changes with a descriptive message
 * Returns true if changes were stashed, false otherwise
 */
async function stashChanges(
	run: CommandExecutor | typeof $,
	branchName: string,
	stdout: (msg: string) => void,
): Promise<boolean> {
	try {
		const hasChanges = await hasUncommittedChanges(run);
		if (!hasChanges) {
			return false;
		}

		stdout(`📦 Stashing uncommitted changes before merge...`);
		const stashMessage = `gf-finish: auto-stashed before merge from ${branchName}`;
		await run`git stash push -m ${stashMessage}`;
		stdout(`   Stashed changes with message: "${stashMessage}"`);
		return true;
	} catch (error) {
		// If stash fails, we continue anyway - the merge might still work
		stdout(
			`   Note: Could not stash changes: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

/**
 * Pop stashed changes, with warning on failure
 */
async function popStashedChanges(
	run: CommandExecutor | typeof $,
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
): Promise<void> {
	try {
		await run`git stash pop`;
		stdout(`📦 Restored stashed changes.`);
	} catch (error) {
		stderr(
			`⚠️  Warning: Could not restore stashed changes. Run 'git stash pop' manually to recover.`,
		);
		stderr(
			`   Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Get the main repository directory (where .git is located)
 * Works from both main repo and worktrees
 */
async function getMainRepoDir(
	run: CommandExecutor | typeof $,
): Promise<string> {
	try {
		// First, try to get the common git directory
		// From a worktree, this will be something like /path/to/main/repo/.git/worktrees/worktree-name
		// From the main repo, this will be /path/to/main/repo/.git
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

		// If we're in a worktree, common-dir is something like /path/to/repo/.git/worktrees/xyz
		// We need to go up to find the actual repo directory
		if (absoluteCommonDir.includes("/.git/worktrees/")) {
			// Extract the repo directory: /path/to/repo/.git/worktrees/xyz -> /path/to/repo
			const worktreesMatch = absoluteCommonDir.match(
				/^(.+?\/\.git)\/worktrees\/.+$/,
			);
			const gitDir = worktreesMatch?.[1];
			if (gitDir) {
				// Return the parent of .git directory (the main repo)
				return resolve(gitDir, "..");
			}
		}

		// If not a worktree, common-dir is just .git, so return parent (the main repo)
		return resolve(absoluteCommonDir, "..");
	} catch {
		// Fallback: try to get the root of the git repository
		// Note: This returns the worktree directory if we're in a worktree, not the main repo
		// So we only use this as a last resort
		try {
			const rootResult = run`git rev-parse --show-toplevel`;
			let root: string;
			if (
				typeof rootResult === "object" &&
				rootResult !== null &&
				"text" in rootResult &&
				typeof rootResult.text === "function"
			) {
				root = (await rootResult.text()).trim();
			} else {
				const resolved = await rootResult;
				root =
					typeof resolved === "string"
						? resolved.trim()
						: resolved !== null && resolved !== undefined
							? String(resolved).trim()
							: "";
			}
			// This might be a worktree directory, so we need to check
			// If it's a worktree, we need to find the main repo
			// Try to read the .git file to find the main repo
			const gitFile = resolve(root, ".git");
			try {
				const { readFileSync } = await import("node:fs");
				const gitContent = readFileSync(gitFile, "utf8").trim();
				// .git file in worktree contains: gitdir: /path/to/main/repo/.git/worktrees/worktree-name
				if (gitContent.startsWith("gitdir: ")) {
					const gitDirPath = gitContent.slice(8).trim();
					const absoluteGitDir = resolve(gitDirPath);
					if (absoluteGitDir.includes("/.git/worktrees/")) {
						const worktreesMatch = absoluteGitDir.match(
							/^(.+?\/\.git)\/worktrees\/.+$/,
						);
						const mainGitDir = worktreesMatch?.[1];
						if (mainGitDir) {
							return resolve(mainGitDir, "..");
						}
					}
				}
			} catch {
				// If we can't read .git file, assume root is the main repo
			}
			return resolve(root);
		} catch {
			// Last resort: use current directory
			return process.cwd();
		}
	}
}

/**
 * Create a command executor that runs git commands in a specific directory
 * Uses process.chdir() to temporarily change directory
 */
function createDirExecutor(
	baseExecutor: CommandExecutor | typeof $,
	dir: string,
): CommandExecutor {
	return async (strings: TemplateStringsArray, ...values: unknown[]) => {
		// Save current directory
		const originalCwd = process.cwd();
		try {
			// Change to target directory
			process.chdir(dir);
			// Execute the command
			// Cast values to work around Bun's ShellExpression type requirements
			// biome-ignore lint/suspicious/noExplicitAny: Bun's $ template requires ShellExpression types
			return await baseExecutor(strings, ...(values as any[]));
		} finally {
			// Always restore original directory
			process.chdir(originalCwd);
		}
	};
}

/**
 * Extended context with optional rootDir for testing
 */
type FinishCommandContext = CommandContext & {
	rootDir?: string;
};

export const finishCommand: CommandDefinition & {
	run: (context: FinishCommandContext) => Promise<number>;
} = {
	name: "finish",
	description: "Merge current branch into base branch and optionally clean up",
	usage: "gitterflow finish",
	run: async ({ stderr, stdout, exec, rootDir }: FinishCommandContext) => {
		const run = exec ?? $;
		let currentBranch = "";

		try {
			// Step 1: Get current branch and worktree path (before checkout)
			stdout("🔍 Detecting current branch...");
			currentBranch = await getCurrentBranch(run);
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

			// Step 2.5: Check if we're already on the base branch
			if (currentBranch === baseBranch) {
				stderr(`\n⚠️  You are already on the base branch (${baseBranch}).`);
				stderr(
					`   The 'finish' command is meant to merge feature branches into the base branch.`,
				);
				stderr(
					`   If you want to push changes on ${baseBranch}, use: git push`,
				);
				return 1;
			}

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
			let mainRepoDir: string | null = null;
			let mainRepoRun: CommandExecutor | typeof $ | null = null;

			try {
				await run`git checkout ${baseBranch}`;
				baseBranchCheckedOut = true;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				const errorObj = error as {
					exitCode?: number;
					stderr?: string | { toString(): string };
				} | null;
				const exitCode = errorObj?.exitCode;
				const stderrOutput =
					typeof errorObj?.stderr === "string"
						? errorObj.stderr
						: typeof errorObj?.stderr === "object" &&
								errorObj.stderr !== null &&
								"toString" in errorObj.stderr
							? errorObj.stderr.toString()
							: "";

				// Combine error message and stderr for detection
				const fullErrorText = `${errorMessage} ${stderrOutput}`.toLowerCase();

				// Check if base branch is already checked out elsewhere
				// This can happen in multiple languages (English, German, etc.)
				const isAlreadyCheckedOut =
					exitCode === 128 ||
					fullErrorText.includes("already checked out") ||
					fullErrorText.includes("is already checked out") ||
					fullErrorText.includes("bereits ausgecheckt") ||
					fullErrorText.includes("ist bereits") ||
					fullErrorText.includes("bereits in");

				if (isAlreadyCheckedOut) {
					// Base branch is checked out in main repo - we'll merge from there
					stdout(
						`   Base branch is checked out in main repo, merging from there...`,
					);
					try {
						mainRepoDir = await getMainRepoDir(run);
						stdout(`   Main repo directory: ${mainRepoDir}`);
						mainRepoRun = createDirExecutor(run, mainRepoDir);
						baseBranchCheckedOut = true; // We'll use main repo executor
					} catch {
						stderr(
							`\n⚠️  ${baseBranch} is already checked out elsewhere, but could not detect main repo directory.`,
						);
						stderr(
							`   Please run this command from the main repository directory, or`,
						);
						stderr(
							`   checkout ${baseBranch} in the main repo and run the merge manually.`,
						);
						stderr(`\n   Alternatively, you can:`);
						stderr(
							`   1. Push your current branch: git push origin ${currentBranch}`,
						);
						stderr(
							`   2. Go to main repo and merge: git checkout ${baseBranch} && git merge ${currentBranch}`,
						);
						stderr(`   3. Push: git push origin ${baseBranch}`);
						return 1;
					}
				} else {
					throw error;
				}
			}

			// Use main repo executor if we're merging from main repo, otherwise use regular executor
			const mergeRun = mainRepoRun ?? run;

			// Step 5.5: Auto-stash uncommitted changes in base branch directory before merge
			let didStash = false;
			if (baseBranchCheckedOut) {
				didStash = await stashChanges(mergeRun, currentBranch, stdout);
			}

			// Step 6: Pull latest changes for base branch
			if (baseBranchCheckedOut) {
				stdout(`📥 Pulling latest changes for ${baseBranch}...`);
				try {
					await mergeRun`git pull origin ${baseBranch}`;
				} catch (pullError) {
					const pullErrorMessage =
						pullError instanceof Error ? pullError.message : String(pullError);
					// Check if pull failed due to uncommitted changes
					if (
						pullErrorMessage.includes("uncommitted changes") ||
						pullErrorMessage.includes("nicht zum Commit vorgemerkt") ||
						pullErrorMessage.includes("Änderungen")
					) {
						stdout(
							`   Note: Could not pull ${baseBranch} due to uncommitted changes.`,
						);
						stdout(
							`   Merge will proceed, but you may want to commit or stash changes in ${baseBranch}.`,
						);
					} else {
						// If pull fails for other reasons, it might be because the branch doesn't exist remotely yet
						// That's okay, we'll continue
						stdout(
							`   Note: Could not pull ${baseBranch} (may not exist remotely yet)`,
						);
					}
				}
			}

			// Step 7: Merge feature branch into base branch
			stdout(`\n🔀 Merging ${currentBranch} into ${baseBranch}...`);
			try {
				// Read agent state to get task description for merge message
				let mergeMessage: string;
				try {
					const agentState = await readAgentState(currentBranch, rootDir);
					if (agentState?.task) {
						// Use task as merge message: "Merge branch 'xyz': task description"
						mergeMessage = `Merge branch '${currentBranch}': ${agentState.task}`;
					} else {
						// Fallback for non-autonomous worktrees
						mergeMessage = `Merge branch '${currentBranch}'`;
					}
				} catch {
					// If reading agent state fails, use fallback message
					mergeMessage = `Merge branch '${currentBranch}'`;
				}

				await mergeRun`git merge ${currentBranch} -m ${mergeMessage}`;
				stdout(`✅ Successfully merged ${currentBranch} into ${baseBranch}`);

				// Step 7.5: Auto-pop stashed changes after successful merge
				if (didStash) {
					await popStashedChanges(mergeRun, stdout, stderr);
				}

				// Update agent state to merged (if exists)
				try {
					const agentState = await readAgentState(currentBranch, rootDir);
					if (agentState) {
						await updateAgentStatus(currentBranch, "merged", rootDir);
					}
				} catch {
					// Ignore errors - agent state may not exist for non-autonomous worktrees
				}
			} catch (error) {
				// Check if it's a merge conflict
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				if (
					errorMessage.includes("conflict") ||
					errorMessage.includes("CONFLICT")
				) {
					// Update agent state to conflict (if exists)
					try {
						const agentState = await readAgentState(currentBranch, rootDir);
						if (agentState) {
							await updateAgentStatus(currentBranch, "conflict", rootDir, {
								error:
									"Merge conflict detected. Resolve conflicts and run gf finish again.",
							});
						}
					} catch {
						// Ignore errors
					}

					stderr(
						`\n❌ Merge conflict detected — please resolve manually before continuing.`,
					);
					stderr(`   Current branch: ${currentBranch}`);
					stderr(`   Base branch: ${baseBranch}`);
					if (mainRepoDir) {
						stderr(`   Go to main repo: cd ${mainRepoDir}`);
						stderr(`   Resolve conflicts and then run: git commit`);
					} else {
						stderr(`   Resolve conflicts and then run: git commit`);
					}
					return 1;
				}
				throw error;
			}

			// Step 8: Skip pushing - user will push manually
			stdout(
				`\n💡 Merge complete. To push, run: git push origin ${baseBranch}`,
			);

			// Step 9: Cleanup options
			const deleteRemoteOnFinish = getSetting("delete_remote_on_finish");

			stdout(`\n🧹 Cleanup options:`);
			stdout(`   Delete remote branch: ${deleteRemoteOnFinish ? "Yes" : "No"}`);

			// IMPORTANT: Remove worktree FIRST before deleting branches
			// The branch cannot be deleted while it's checked out in a worktree
			stdout(`   Removing worktree for branch: ${currentBranch}`);
			let worktreeRemoved = false;

			// Try 1: Remove by stored worktree path (most reliable)
			try {
				await run`git worktree remove ${currentWorktreePath}`;
				stdout(`✅ Removed worktree: ${currentWorktreePath}`);
				worktreeRemoved = true;
			} catch {
				// Try 2: Remove by relative path (common pattern: ../branch-name)
				try {
					await run`git worktree remove ../${currentBranch}`;
					stdout(`✅ Removed worktree: ../${currentBranch}`);
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
							stdout(
								`   Note: Could not remove worktree (may have already been removed or path differs)`,
							);
						}
					}
				}
			}

			// Now that worktree is removed, we can delete the branches
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
			// Only try to delete if worktree was successfully removed
			if (worktreeRemoved) {
				const localBranchExists = await branchExists(run, currentBranch, false);
				if (localBranchExists) {
					stdout(`   Deleting local branch: ${currentBranch}`);
					try {
						await run`git branch -d ${currentBranch}`;
						stdout(`✅ Deleted local branch: ${currentBranch}`);
					} catch (error) {
						stderr(
							`⚠️  Failed to delete local branch: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}
			} else {
				stdout(
					`   Skipping local branch deletion (worktree removal failed or branch still checked out)`,
				);
			}

			// Success summary
			stdout(`\n✅ Successfully finished work on ${currentBranch}`);
			stdout(`   Merged into: ${baseBranch}`);
			stdout(`   To push: git push origin ${baseBranch}`);

			// Send completion notification
			try {
				const agentState = await readAgentState(currentBranch, rootDir);
				await notify({
					type: "completed",
					branch: currentBranch,
					task: agentState?.task,
					baseBranch: baseBranch,
					timestamp: new Date().toISOString(),
				});
			} catch {
				// Ignore notification errors
			}

			return 0;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);

			// Update agent state to failed (if exists and branch is known)
			if (currentBranch) {
				try {
					const agentState = await readAgentState(currentBranch, rootDir);
					if (agentState) {
						await updateAgentStatus(currentBranch, "failed", rootDir, {
							error: errorMessage,
						});
					}

					// Send failure notification
					await notify({
						type: "failed",
						branch: currentBranch,
						task: agentState?.task,
						timestamp: new Date().toISOString(),
						details: { error: errorMessage },
					});
				} catch {
					// Ignore errors
				}
			}

			stderr(`❌ Failed to finish: ${errorMessage}`);
			return 1;
		}
	},
};
