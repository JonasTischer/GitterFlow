import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
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

export const rejectCommand: CommandDefinition = {
	name: "reject",
	description: "Reject a subagent's plan with feedback",
	usage: "gitterflow reject <branch> --message <feedback>",

	run: async ({
		args,
		stdout,
		stderr,
	}: CommandContext): Promise<number> => {
		const { branch, message } = parseArgs(args);

		if (!branch) {
			stderr("Usage: gf reject <branch> --message <feedback>");
			stderr("  Reject an agent's plan and provide feedback");
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
			stderr("   Only agents in 'awaiting_approval' status can be rejected.");
			return 1;
		}

		// Ensure the agent workspace directory exists
		const agentDir = join(".gitterflow", "agents", branch);
		await mkdir(agentDir, { recursive: true });

		// Write rejection marker
		const approvalPath = join(agentDir, "approval.yaml");
		const rejectionContent = [
			"approved: false",
			`rejected_at: ${new Date().toISOString()}`,
			message ? `reason: "${message.replace(/"/g, '\\"')}"` : "",
		]
			.filter(Boolean)
			.join("\n");
		await Bun.write(approvalPath, rejectionContent + "\n");

		// Write brain feedback if message provided
		if (message) {
			const feedbackPath = join(agentDir, "brain-feedback.md");
			const feedbackContent = `# Brain Feedback

Rejected at: ${new Date().toISOString()}

## Feedback

${message}

## Next Steps

The agent can:
1. Re-analyze and create a new plan addressing the feedback
2. Ask clarifying questions before re-planning
3. The worktree remains available for manual work if needed
`;
			await Bun.write(feedbackPath, feedbackContent);
		}

		// Update status to failed with rejection reason
		await updateAgentStatus(branch, "failed", {
			error: message ? `Plan rejected: ${message}` : "Plan rejected by brain",
		});

		stdout(`❌ Rejected plan for ${branch}`);
		if (message) {
			stdout(`📝 Feedback: ${message}`);
		}
		stdout("");
		stdout("💡 Options:");
		stdout(`   - Re-plan: Navigate to worktree and run 'gf new --plan-first'`);
		stdout(`   - Manual: Work directly in the worktree at ${state.worktree_path}`);
		stdout(`   - Cleanup: Run 'git worktree remove ${state.worktree_path}'`);

		return 0;
	},
};
