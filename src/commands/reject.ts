/**
 * gf reject - Reject a subagent's plan with feedback
 *
 * Part of the plan-then-execute workflow (Issue 6).
 * See docs/PLAN-APPROVAL-DESIGN.md for full design.
 *
 * Usage:
 *   gf reject <branch> --message <feedback>
 *
 * What this command will do when fully implemented:
 * 1. Validate agent is in "awaiting_approval" status
 * 2. Write rejection marker with feedback to agent workspace
 * 3. Write brain feedback to .gitterflow/agents/{branch}/brain-feedback.md
 * 4. Update agent status to "failed" (or a new "rejected" status)
 * 5. Leave worktree intact for potential re-planning
 */

import { readAgentState } from "../utils/agent-state";
import type { CommandContext, CommandDefinition } from "./types";

/**
 * Parse reject command arguments
 */
function parseRejectArgs(args: string[]): {
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

export const rejectCommand: CommandDefinition = {
	name: "reject",
	description: "Reject a subagent's plan with feedback",
	usage: "gitterflow reject <branch> --message <feedback>",

	run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
		const { branch, message } = parseRejectArgs(args);

		if (!branch) {
			stderr("Usage: gf reject <branch> --message <feedback>");
			stderr("");
			stderr("Reject a subagent's implementation plan and provide feedback.");
			stderr("The agent must be in 'awaiting_approval' status.");
			return 1;
		}

		if (!message) {
			stderr("❌ Please provide feedback with --message <feedback>");
			stderr("");
			stderr(
				"   Feedback helps the agent understand why the plan was rejected",
			);
			stderr("   and what changes are needed for re-planning.");
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
			stderr("   Only agents with status 'awaiting_approval' can be rejected.");
			return 1;
		}

		// TODO: Implement full rejection workflow
		// 1. Write rejection marker: .gitterflow/agents/{branch}/approval.yaml
		// 2. Write feedback: .gitterflow/agents/{branch}/brain-feedback.md
		// 3. Update agent status to "failed" with error message
		// See docs/PLAN-APPROVAL-DESIGN.md for implementation details

		stdout("⚠️  gf reject is not yet fully implemented.");
		stdout("   See docs/PLAN-APPROVAL-DESIGN.md for the planned workflow.");
		stdout("");
		stdout(`   Would reject plan for: ${branch}`);
		stdout(`   With feedback: ${message}`);
		stdout("");
		stdout("   After rejection, options would be:");
		stdout("   1. Re-plan in the same worktree with updated task");
		stdout("   2. Delete the worktree and spawn a new agent");
		stdout("   3. Manually fix the plan and re-approve");

		return 0;
	},
};
