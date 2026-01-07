import { $ } from "bun";
import { readAgentState, updateAgentStatus } from "../utils/agent-state";
import type {
	CommandContext,
	CommandDefinition,
	CommandExecutor,
} from "./types";

/**
 * Extended context with optional rootDir for testing
 */
type MarkFailedCommandContext = CommandContext & {
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

/**
 * Parse error message from command arguments
 */
function parseErrorMessage(args: string[]): string | undefined {
	const errorIndex = args.findIndex((a) => a === "--error" || a === "-e");
	if (errorIndex !== -1 && args[errorIndex + 1]) {
		return args[errorIndex + 1];
	}
	return undefined;
}

export const markFailedCommand: CommandDefinition & {
	run: (context: MarkFailedCommandContext) => Promise<number>;
} = {
	name: "mark-failed",
	description: "Mark an autonomous agent as failed",
	usage: "gitterflow mark-failed [--error <message>]",
	run: async (context: MarkFailedCommandContext): Promise<number> => {
		const { args, stdout, stderr, rootDir, exec } = context;
		const run = exec ?? $;

		try {
			// Get current branch
			const branch = await getCurrentBranch(run);

			// Check if agent state exists
			const state = await readAgentState(branch, rootDir);
			if (!state) {
				stderr(`No agent state found for branch '${branch}'`);
				return 1;
			}

			// Parse error message from args
			const errorMessage = parseErrorMessage(args);

			// Update agent state to failed
			await updateAgentStatus(
				branch,
				"failed",
				rootDir,
				errorMessage ? { error: errorMessage } : undefined,
			);

			stdout(`Agent '${branch}' marked as failed`);
			return 0;
		} catch (error) {
			stderr(
				`Failed to mark agent as failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
