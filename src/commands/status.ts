import type { AgentState } from "../utils/agent-state";
import { listAgentStates } from "../utils/agent-state";
import type { CommandContext, CommandDefinition } from "./types";

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
};

export const statusCommand: CommandDefinition & {
	run: (context: StatusCommandContext) => Promise<number>;
} = {
	name: "status",
	description: "Display status of all autonomous agents",
	usage: "gitterflow status",
	run: async ({ stdout, rootDir }: StatusCommandContext): Promise<number> => {
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
