import { $ } from "bun";
import type { AgentState } from "../utils/agent-state";
import {
	listAgentStates,
	readAgentState,
	writeAgentState,
} from "../utils/agent-state";
import type {
	CommandContext,
	CommandDefinition,
	CommandExecutor,
} from "./types";

/**
 * Status priority order for sorting agents
 * Lower number = displayed first
 */
const STATUS_PRIORITY: Record<AgentState["status"], number> = {
	running: 0,
	pending: 1,
	completed: 2,
	failed: 3,
	conflict: 4,
	merged: 5,
};

/**
 * Column widths for the table
 */
const COLUMN_WIDTHS = {
	branch: 25,
	status: 12,
	task: 25,
	started: 12,
};

const TABLE_WIDTH =
	COLUMN_WIDTHS.branch +
	COLUMN_WIDTHS.status +
	COLUMN_WIDTHS.task +
	COLUMN_WIDTHS.started +
	3; // 3 spaces between columns

/**
 * Format a timestamp as relative time (e.g., "2 min ago")
 */
function formatRelativeTime(isoTimestamp: string): string {
	const timestamp = new Date(isoTimestamp).getTime();
	const now = Date.now();
	const diffMs = now - timestamp;

	const seconds = Math.floor(diffMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days} day${days === 1 ? "" : "s"} ago`;
	}
	if (hours > 0) {
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	if (minutes > 0) {
		return `${minutes} min ago`;
	}
	return `${seconds} sec ago`;
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed
 */
function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}
	return `${str.slice(0, maxLength - 3)}...`;
}

/**
 * Pad a string to a fixed width
 */
function padEnd(str: string, width: number): string {
	if (str.length >= width) {
		return str;
	}
	return str + " ".repeat(width - str.length);
}

/**
 * Sort agents by status priority
 */
function sortByStatus(agents: AgentState[]): AgentState[] {
	return [...agents].sort((a, b) => {
		return STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
	});
}

/**
 * Format a single agent row
 */
function formatAgentRow(agent: AgentState): string {
	const branch = padEnd(
		truncate(agent.branch, COLUMN_WIDTHS.branch),
		COLUMN_WIDTHS.branch,
	);
	const status = padEnd(agent.status, COLUMN_WIDTHS.status);
	const task = padEnd(
		truncate(agent.task, COLUMN_WIDTHS.task),
		COLUMN_WIDTHS.task,
	);
	const started = formatRelativeTime(agent.started_at);

	return `${branch} ${status} ${task} ${started}`;
}

/**
 * Extended context with optional rootDir for testing
 */
type StatusCommandContext = CommandContext & {
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
 * Handle --write flag: update agent status message
 */
async function writeStatusMessage(
	message: string,
	context: StatusCommandContext,
): Promise<number> {
	const { stdout, stderr, rootDir, exec } = context;
	const run = exec ?? $;

	try {
		const branch = await getCurrentBranch(run);
		const state = await readAgentState(branch, rootDir);

		if (!state) {
			stderr(`No autonomous agent found for branch '${branch}'`);
			return 1;
		}

		await writeAgentState(
			{
				...state,
				message,
			},
			rootDir,
		);

		stdout(`Status updated for ${branch}`);
		return 0;
	} catch (error) {
		stderr(
			`Failed to update status: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}
}

export const statusCommand: CommandDefinition & {
	run: (context: StatusCommandContext) => Promise<number>;
} = {
	name: "status",
	description: "Display status of all autonomous agents",
	usage: "gitterflow status [--write <message>]",
	run: async (context: StatusCommandContext): Promise<number> => {
		const { args, stdout, stderr, rootDir } = context;

		// Check for --write flag first
		const writeIndex = args.findIndex((a) => a === "--write" || a === "-w");
		if (writeIndex !== -1) {
			const message = args[writeIndex + 1];
			if (!message || message.startsWith("-")) {
				stderr("Message required with --write flag");
				return 1;
			}
			return writeStatusMessage(message, context);
		}

		const agents = await listAgentStates(rootDir);

		if (agents.length === 0) {
			stdout("No autonomous agents found.");
			return 0;
		}

		// Sort agents by status priority
		const sortedAgents = sortByStatus(agents);

		// Print header
		const separator = "─".repeat(TABLE_WIDTH);

		stdout("");
		stdout("AUTONOMOUS AGENTS");
		stdout(separator);

		// Print column headers
		const headerBranch = padEnd("Branch", COLUMN_WIDTHS.branch);
		const headerStatus = padEnd("Status", COLUMN_WIDTHS.status);
		const headerTask = padEnd("Task", COLUMN_WIDTHS.task);
		const headerStarted = "Started";

		stdout(`${headerBranch} ${headerStatus} ${headerTask} ${headerStarted}`);
		stdout(separator);

		// Print agent rows
		for (const agent of sortedAgents) {
			stdout(formatAgentRow(agent));
		}

		stdout(separator);

		return 0;
	},
};
