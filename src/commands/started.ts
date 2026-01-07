import { $ } from "bun";
import { readAgentState, writeAgentState } from "../utils/agent-state";
import type {
	CommandContext,
	CommandDefinition,
	CommandExecutor,
} from "./types";

/**
 * Extended context with optional rootDir for testing
 */
type StartedCommandContext = CommandContext & {
	rootDir?: string;
	exec?: CommandExecutor;
};

/**
 * Get current branch name
 */
async function getCurrentBranch(
	exec: CommandExecutor | typeof $,
): Promise<string> {
	const result = exec`git rev-parse --abbrev-ref HEAD`;
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

export const startedCommand: CommandDefinition & {
	run: (context: StartedCommandContext) => Promise<number>;
} = {
	name: "started",
	description: "Mark autonomous agent as running (called by Start hook)",
	usage: "gitterflow started",
	run: async (context: StartedCommandContext): Promise<number> => {
		const { rootDir, exec } = context;
		const run = exec ?? $;

		try {
			const branch = await getCurrentBranch(run);
			const state = await readAgentState(branch, rootDir);

			// Silently succeed if no agent state exists (non-autonomous worktree)
			if (!state) {
				return 0;
			}

			// Silently succeed if status is not pending (idempotent behavior)
			if (state.status !== "pending") {
				return 0;
			}

			// Update status from pending to running and set actual start time
			await writeAgentState(
				{
					...state,
					status: "running",
					started_at: new Date().toISOString(),
				},
				rootDir,
			);

			return 0;
		} catch {
			// Silently succeed on any error to avoid breaking the Start hook
			return 0;
		}
	},
};
