import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import { spawnTerminal } from "../utils/terminal";
import type { CommandContext, CommandDefinition, CommandExecutor } from "./types";

/**
 * Parse command line arguments
 * Returns { branch, message }
 */
function parseArgs(args: string[]): {
	branch?: string;
	message?: string;
} {
	let branch: string | undefined;
	let message: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--message" || arg === "-m") {
			message = args[i + 1];
			i++; // Skip the message value
		} else if (!arg.startsWith("-") && !branch) {
			branch = arg;
		}
	}

	return { branch, message };
}

/**
 * Merge a branch into its base branch
 */
async function mergeBranch(
	run: CommandExecutor | typeof $,
	branch: string,
	baseBranch: string,
	stdout: (msg: string) => void,
): Promise<boolean> {
	try {
		// Merge the branch
		const mergeMessage = `Merge branch '${branch}' (approved)`;
		await run`git merge ${branch} -m ${mergeMessage}`;
		stdout(`✅ Merged ${branch} into ${baseBranch}`);
		return true;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (errorMessage.includes("conflict") || errorMessage.includes("CONFLICT")) {
			return false;
		}
		throw error;
	}
}

export const approveCommand: CommandDefinition = {
	name: "approve",
	description: "Approve a subagent's work (plan or ready) and merge or start execution",
	usage: "gitterflow approve <branch> [--message <feedback>]",

	run: async ({ args, stdout, stderr, exec }: CommandContext): Promise<number> => {
		const run = exec ?? $;
		const { branch, message } = parseArgs(args);

		if (!branch) {
			stderr("Usage: gf approve <branch>");
			stderr("  For 'ready' status: merge the completed work");
			stderr("  For 'awaiting_approval' status: start execution phase");
			return 1;
		}

		// Read agent state
		const state = await readAgentState(branch);
		if (!state) {
			stderr(`❌ No agent found for branch: ${branch}`);
			return 1;
		}

		// Allow approval from either 'awaiting_approval' (plan mode) or 'ready' (review mode)
		if (state.status !== "awaiting_approval" && state.status !== "ready") {
			stderr(
				`❌ Agent is not awaiting approval or ready for review (current status: ${state.status})`,
			);
			stderr("   Only agents in 'awaiting_approval' or 'ready' status can be approved.");
			return 1;
		}
		
		const isReviewMode = state.status === "ready";

		// Ensure the agent workspace directory exists
		const agentDir = join(".gitterflow", "agents", branch);
		await mkdir(agentDir, { recursive: true });

		// Write approval marker
		const approvalPath = join(agentDir, "approval.yaml");
		const approvalContent = [
			"approved: true",
			`approved_at: ${new Date().toISOString()}`,
			`mode: ${isReviewMode ? "review" : "plan"}`,
			message ? `message: "${message}"` : "",
		]
			.filter(Boolean)
			.join("\n");
		await Bun.write(approvalPath, `${approvalContent}\n`);

		if (isReviewMode) {
			// REVIEW MODE: Merge the completed work
			stdout(`✅ Approved work for ${branch}`);
			if (message) {
				stdout(`📝 Note: ${message}`);
			}
			stdout(`\n🔀 Merging ${branch} into ${state.base_branch}...`);

			try {
				const merged = await mergeBranch(run, branch, state.base_branch, stdout);
				if (!merged) {
					await updateAgentStatus(branch, "conflict");
					stderr(`\n❌ Merge conflict detected.`);
					stderr(`   Resolve conflicts manually, then commit.`);
					return 1;
				}

				await updateAgentStatus(branch, "merged");
				
				// Cleanup worktree
				if (state.worktree_path) {
					stdout(`\n🧹 Cleaning up worktree...`);
					try {
						await run`git worktree remove ${state.worktree_path}`;
						stdout(`   Removed: ${state.worktree_path}`);
					} catch {
						stdout(`   Note: Could not remove worktree (may be in use)`);
					}
					
					// Try to delete local branch
					try {
						await run`git branch -d ${branch}`;
						stdout(`   Deleted branch: ${branch}`);
					} catch {
						stdout(`   Note: Could not delete branch (may have unmerged changes)`);
					}
				}

				stdout(`\n✅ Successfully merged and cleaned up ${branch}`);
				stdout(`💡 To push: git push origin ${state.base_branch}`);
				return 0;
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				await updateAgentStatus(branch, "failed", undefined, { error: errorMessage });
				stderr(`❌ Merge failed: ${errorMessage}`);
				return 1;
			}
		} else {
			// PLAN MODE: Spawn execution phase
			await updateAgentStatus(branch, "running");

			stdout(`✅ Approved plan for ${branch}`);
			if (message) {
				stdout(`📝 Feedback: ${message}`);
			}
			stdout(`📍 Spawning execution phase...`);

			// Spawn execution phase in the worktree
			const baseAgentCommand = getSetting("coding_agent");
			const planPath = state.plan_file || `.gitterflow/agents/${branch}/plan.md`;

			const executionPrompt = `Execute the approved plan.

Read the plan file at: ${planPath}
Implement exactly what was planned.

When complete, run: gf finish

Do not deviate from the approved plan without good reason.`;

			// Build the execution command
			const isClaude =
				baseAgentCommand === "claude" || baseAgentCommand.startsWith("claude ");

			let agentCommand: string;
			if (isClaude) {
				const systemPrompt =
					"When you complete this task, use the gitterflow skill to finish and merge your changes back to the base branch.";
				const escapedPrompt = executionPrompt.replace(/"/g, '\\"');
				agentCommand = `claude --permission-mode acceptEdits --append-system-prompt "${systemPrompt}" "${escapedPrompt}"`;
			} else {
				const escapedPrompt = executionPrompt.replace(/"/g, '\\"');
				agentCommand = `${baseAgentCommand} "${escapedPrompt}"`;
			}

			// Skip terminal spawning in CI/test environments
			const skipTerminalSpawn =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (!skipTerminalSpawn && state.worktree_path) {
				try {
					spawnTerminal(state.worktree_path, agentCommand);
					stdout(`🚀 Execution phase started for ${branch}`);
				} catch {
					stdout(`cd ${state.worktree_path}`);
					stdout(agentCommand);
					stderr(`⚠️  Could not open terminal. Run the command above manually.`);
				}
			} else {
				stdout(`cd ${state.worktree_path || "."}`);
				stdout(agentCommand);
			}

			return 0;
		}
	},
};
