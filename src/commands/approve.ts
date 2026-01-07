/**
 * gf approve - Approve a subagent's plan and start execution phase
 *
 * Part of the plan-then-execute workflow (Issue 6).
 * See docs/PLAN-APPROVAL-DESIGN.md for full design.
 *
 * Usage:
 *   gf approve <branch> [--message <feedback>]
 *
 * What this command will do when fully implemented:
 * 1. Validate agent is in "awaiting_approval" status
 * 2. Read and validate the plan file exists
 * 3. Write approval marker to agent workspace
 * 4. Update agent status to "running"
 * 5. Spawn execution phase with full permissions
 */

import { readAgentState } from "../utils/agent-state";
import type { CommandContext, CommandDefinition } from "./types";

/**
 * Parse approve command arguments
 */
function parseApproveArgs(args: string[]): {
	branch?: string;
	message?: string;
} {
	let branch: string | undefined;
	let message: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--message" || arg === "-m") {
			message = args[i + 1];
			i++;
		} else if (!arg.startsWith("-")) {
			if (!branch) {
				branch = arg;
			}
		}
	}

	return { branch, message };
}

export const approveCommand: CommandDefinition = {
	name: "approve",
	description: "Approve a subagent's plan and start execution phase",
	usage: "gitterflow approve <branch> [--message <feedback>]",

	run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
		const { branch, message } = parseApproveArgs(args);

		if (!branch) {
			stderr("Usage: gf approve <branch> [--message <feedback>]");
			stderr("");
			stderr(
				"Approve a subagent's implementation plan and spawn execution phase.",
			);
			stderr("The agent must be in 'awaiting_approval' status.");
			return 1;
		}

		// Check if agent exists
		const state = await readAgentState(branch);
		if (!state) {
			stderr(`❌ No agent found for branch: ${branch}`);
			stderr("   Run 'gf status' to see available agents.");
			return 1;
		}

		// Validate status
		if (state.status !== "awaiting_approval") {
			stderr(
				`❌ Agent is not awaiting approval (current status: ${state.status})`,
			);
			stderr("");
			stderr("   Only agents with status 'awaiting_approval' can be approved.");
			stderr("   This status is set when an agent spawned with --plan-first");
			stderr("   completes its planning phase.");
			return 1;
		}

		// TODO: Implement full approval workflow
		// 1. Write approval marker: .gitterflow/agents/{branch}/approval.yaml
		// 2. Update agent status to "running"
		// 3. Spawn execution phase in the worktree
		// See docs/PLAN-APPROVAL-DESIGN.md for implementation details

		stdout("⚠️  gf approve is not yet fully implemented.");
		stdout("   See docs/PLAN-APPROVAL-DESIGN.md for the planned workflow.");
		stdout("");
		stdout(`   Would approve plan for: ${branch}`);
		if (state.plan_file) {
			stdout(`   Plan file: ${state.plan_file}`);
		}
		if (message) {
			stdout(`   With message: ${message}`);
		}

		return 0;
	},
};
