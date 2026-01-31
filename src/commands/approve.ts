import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getSetting } from "../config";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import { spawnTerminal } from "../utils/terminal";
import type { CommandContext, CommandDefinition } from "./types";

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

export const approveCommand: CommandDefinition = {
	name: "approve",
	description: "Approve a subagent's plan and start execution phase",
	usage: "gitterflow approve <branch> [--message <feedback>]",

	run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
		const { branch, message } = parseArgs(args);

		if (!branch) {
			stderr("Usage: gf approve <branch>");
			stderr("  Approve an agent's plan and start execution phase");
			return 1;
		}

		// Read agent state
		const state = await readAgentState(branch);
		if (!state) {
			stderr(`❌ No agent found for branch: ${branch}`);
			return 1;
		}

		if (state.status !== "awaiting_approval") {
			stderr(
				`❌ Agent is not awaiting approval (current status: ${state.status})`,
			);
			stderr("   Only agents in 'awaiting_approval' status can be approved.");
			return 1;
		}

		// Ensure the agent workspace directory exists
		const agentDir = join(".gitterflow", "agents", branch);
		await mkdir(agentDir, { recursive: true });

		// Write approval marker
		const approvalPath = join(agentDir, "approval.yaml");
		const approvalContent = [
			"approved: true",
			`approved_at: ${new Date().toISOString()}`,
			message ? `message: "${message}"` : "",
		]
			.filter(Boolean)
			.join("\n");
		await Bun.write(approvalPath, `${approvalContent}\n`);

		// Update status to running
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
	},
};
