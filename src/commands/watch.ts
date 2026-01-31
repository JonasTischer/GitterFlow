import { listAgentStates, type AgentState } from "../utils/agent-state";
import type { CommandContext, CommandDefinition } from "./types";

/**
 * Format a timestamp as relative time (e.g., "5m ago")
 */
function formatRelativeTime(timestamp: string): string {
	const now = Date.now();
	const then = new Date(timestamp).getTime();
	const diffMs = now - then;
	const diffSec = Math.floor(diffMs / 1000);
	const diffMin = Math.floor(diffSec / 60);
	const diffHour = Math.floor(diffMin / 60);

	if (diffSec < 60) return `${diffSec}s ago`;
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHour < 24) return `${diffHour}h ago`;
	return `${Math.floor(diffHour / 24)}d ago`;
}

/**
 * Get status emoji
 */
function statusEmoji(status: string): string {
	const emojis: Record<string, string> = {
		pending: "⏳",
		awaiting_approval: "📋",
		running: "🔄",
		ready: "✅",
		completed: "🎉",
		failed: "❌",
		conflict: "⚠️",
		merged: "🔗",
	};
	return emojis[status] || "❓";
}

/**
 * Format agent state for display
 */
function formatAgent(agent: AgentState): string {
	const emoji = statusEmoji(agent.status);
	const time = formatRelativeTime(agent.started_at);
	const task = agent.task.length > 40 
		? agent.task.substring(0, 37) + "..." 
		: agent.task;
	
	return `${emoji} ${agent.branch.padEnd(30)} ${agent.status.padEnd(18)} ${task.padEnd(42)} ${time}`;
}

/**
 * Clear screen and move cursor to top
 */
function clearScreen(stdout: (msg: string) => void): void {
	stdout("\x1B[2J\x1B[H");
}

/**
 * Parse command arguments
 */
function parseArgs(args: string[]): {
	interval: number;
	once: boolean;
} {
	let interval = 5000; // 5 seconds default
	let once = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--interval" || arg === "-i") {
			interval = parseInt(args[i + 1] || "5000", 10);
			i++;
		} else if (arg === "--once" || arg === "-1") {
			once = true;
		}
	}

	return { interval, once };
}

export const watchCommand: CommandDefinition = {
	name: "watch",
	description: "Live monitor of agent progress (refreshes automatically)",
	usage: "gitterflow watch [--interval ms] [--once]",

	run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
		const { interval, once } = parseArgs(args);

		const render = async () => {
			const agents = await listAgentStates();

			if (agents.length === 0) {
				clearScreen(stdout);
				stdout("GitterFlow Watch");
				stdout("═".repeat(50));
				stdout("");
				stdout("No active agents found.");
				stdout("");
				stdout("Start an agent with: gf new --task 'your task' --autonomous");
				return;
			}

			// Sort: running first, then by start time
			agents.sort((a, b) => {
				const statusOrder: Record<string, number> = {
					running: 0,
					awaiting_approval: 1,
					pending: 2,
					ready: 3,
					conflict: 4,
					failed: 5,
					completed: 6,
					merged: 7,
				};
				const orderA = statusOrder[a.status] ?? 99;
				const orderB = statusOrder[b.status] ?? 99;
				if (orderA !== orderB) return orderA - orderB;
				return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
			});

			// Count by status
			const counts: Record<string, number> = {};
			for (const agent of agents) {
				counts[agent.status] = (counts[agent.status] || 0) + 1;
			}

			clearScreen(stdout);
			stdout("GitterFlow Watch");
			stdout("═".repeat(100));
			stdout("");
			
			// Summary line
			const summary = Object.entries(counts)
				.map(([status, count]) => `${statusEmoji(status)} ${status}: ${count}`)
				.join("  │  ");
			stdout(summary);
			stdout("");
			
			// Header
			stdout("─".repeat(100));
			stdout(`${"Branch".padEnd(32)} ${"Status".padEnd(18)} ${"Task".padEnd(42)} ${"Started"}`);
			stdout("─".repeat(100));
			
			// Agents
			for (const agent of agents) {
				stdout(formatAgent(agent));
			}
			
			stdout("─".repeat(100));
			stdout("");
			if (!once) {
				stdout(`Refreshing every ${interval / 1000}s. Press Ctrl+C to exit.`);
			}
		};

		// Initial render
		await render();

		if (once) {
			return 0;
		}

		// Set up interval for continuous monitoring
		const intervalId = setInterval(render, interval);

		// Handle graceful shutdown
		const cleanup = () => {
			clearInterval(intervalId);
			stdout("\n👋 Watch stopped.");
			process.exit(0);
		};

		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);

		// Keep the process alive
		await new Promise(() => {});
		
		return 0;
	},
};
