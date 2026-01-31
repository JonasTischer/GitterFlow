import { getSetting } from "../config";

export interface AgentEvent {
	type: "started" | "ready" | "completed" | "failed" | "approved" | "rejected";
	branch: string;
	task?: string;
	baseBranch?: string;
	worktreePath?: string;
	timestamp: string;
	details?: Record<string, unknown>;
}

/**
 * Send notification to configured webhook URL
 * Silently fails if no webhook configured or request fails
 */
export async function notifyWebhook(event: AgentEvent): Promise<void> {
	try {
		const webhookUrl = getSetting("webhook_url");
		if (!webhookUrl) return;

		await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": "GitterFlow/1.0",
			},
			body: JSON.stringify({
				...event,
				source: "gitterflow",
			}),
		});
	} catch {
		// Silently fail - notifications are best-effort
	}
}

/**
 * Check if running inside a Clawdbot session and notify parent
 */
export async function notifyClawdbot(event: AgentEvent): Promise<void> {
	try {
		const clawdbotSession = process.env.CLAWDBOT_SESSION;
		const clawdbotGateway = process.env.CLAWDBOT_GATEWAY_URL;

		if (!clawdbotSession || !clawdbotGateway) return;

		const message = formatEventMessage(event);

		// Use Clawdbot's session API to notify parent
		await fetch(`${clawdbotGateway}/api/sessions/${clawdbotSession}/send`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.CLAWDBOT_TOKEN}`,
			},
			body: JSON.stringify({ message }),
		});
	} catch {
		// Silently fail
	}
}

/**
 * Format event into human-readable message
 */
function formatEventMessage(event: AgentEvent): string {
	const emoji = {
		started: "🚀",
		ready: "✅",
		completed: "🎉",
		failed: "❌",
		approved: "👍",
		rejected: "👎",
	}[event.type];

	const action = {
		started: "started working on",
		ready: "is ready for review on",
		completed: "completed work on",
		failed: "failed on",
		approved: "was approved for",
		rejected: "was rejected for",
	}[event.type];

	let message = `${emoji} GitterFlow agent ${action} branch \`${event.branch}\``;

	if (event.task) {
		message += `\nTask: ${event.task}`;
	}

	return message;
}

/**
 * Send notifications to all configured channels
 */
export async function notify(event: AgentEvent): Promise<void> {
	await Promise.all([notifyWebhook(event), notifyClawdbot(event)]);
}
