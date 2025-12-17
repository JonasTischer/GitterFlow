import * as p from "@clack/prompts";
import { $ } from "bun";
import { getSetting } from "../config";
import type { CommandDefinition } from "./types";

/**
 * Get the configured OpenRouter model from environment variable or config file
 * Defaults to "qwen/qwen3-235b-a22b-2507" if not configured
 */
const _aiModel = getSetting("ai_model");

/**
 * Prompt user for commit message confirmation with option to edit
 * Supports single-key shortcuts: y (yes), e (edit), n (cancel)
 * Returns the commit message to use (original or edited)
 */
async function promptCommitMessage(
	generatedMessage: string,
): Promise<string | null> {
	// Show the options
	console.log("\n");
	console.log("  Commit with this message?");
	console.log("  • Yes (y) - Commit with this message");
	console.log("  • Edit (e) - Modify the message");
	console.log("  • Cancel (n) - Don't commit");
	console.log("");

	// Set stdin to raw mode to capture single key presses
	const wasRaw = process.stdin.isRaw;
	if (!wasRaw) {
		process.stdin.setRawMode(true);
	}
	process.stdin.resume();
	process.stdin.setEncoding("utf8");

	return new Promise((resolve) => {
		const onData = (key: string) => {
			// Handle Ctrl+C
			if (key === "\u0003") {
				process.stdin.setRawMode(wasRaw);
				process.stdin.pause();
				process.stdin.removeListener("data", onData);
				resolve(null);
				return;
			}

			const lowerKey = key.toLowerCase().trim();

			// Restore stdin
			process.stdin.setRawMode(wasRaw);
			process.stdin.pause();
			process.stdin.removeListener("data", onData);

			if (lowerKey === "y" || lowerKey === "\r" || lowerKey === "\n") {
				// Yes - commit with generated message
				console.log("  ✓ Yes\n");
				resolve(generatedMessage);
			} else if (lowerKey === "e") {
				// Edit - prompt for edited message
				console.log("  ✏ Edit\n");
				// Use @clack/prompts for the edit input
				(async () => {
					const editedMessage = await p.text({
						message: "Edit commit message:",
						initialValue: generatedMessage,
						placeholder: generatedMessage,
					});
					if (p.isCancel(editedMessage)) {
						resolve(null);
					} else {
						resolve(editedMessage?.trim() || generatedMessage);
					}
				})();
				return; // Don't resolve yet, wait for edit input
			} else if (lowerKey === "n" || lowerKey === "\u001b") {
				// Cancel or Escape
				console.log("  ✗ Cancel\n");
				resolve(null);
			} else {
				// Invalid key - restart the prompt
				console.log(
					`  Invalid key '${key}'. Press y (yes), e (edit), or n (cancel)\n`,
				);
				resolve(promptCommitMessage(generatedMessage));
			}
		};

		process.stdin.once("data", onData);
	});
}

/**
 * Generate commit message from diff using OpenRouter API
 */
async function generateCommitMessage(diff: string): Promise<string> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) {
		throw new Error("OPENROUTER_API_KEY environment variable is not set");
	}

	const prompt = `You are a helpful assistant that writes concise, high-quality git commit messages.

Summarize the following diff into one short commit message (max 15 words).

Use the conventional commits style (e.g. 'feat:', 'fix:', 'refactor:').

Diff:
${diff}`;

	const model = _aiModel;

	const requestBody: {
		model: string;
		messages: Array<{ role: string; content: string }>;
		provider?: { sort: string };
	} = {
		model,
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
		provider: {
			sort: "throughput",
		},
	};

	const response = await fetch(
		"https://openrouter.ai/api/v1/chat/completions",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(requestBody),
		},
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`,
		);
	}

	const data = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};

	const message =
		data.choices?.[0]?.message?.content?.trim() || "chore: update code";

	return message;
}

export const snapCommand: CommandDefinition = {
	name: "snap",
	description:
		"Automatically commit staged or modified changes with AI-generated commit message",
	usage: "gitterflow snap [--no-confirm]",
	run: async ({ args, stderr, stdout, exec }) => {
		const noConfirm = args.includes("--no-confirm");
		const run = exec ?? $;

		try {
			// Stage all modified and deleted files
			await run`git add -A`;

			// Get the diff of staged changes
			// Bun's $ API: run`command`.text() returns Promise<string>
			// Handle both real Bun $ API and mocked exec
			const diffResult = run`git diff --cached`;
			let diff: string;
			if (
				typeof diffResult === "object" &&
				diffResult !== null &&
				"text" in diffResult &&
				typeof diffResult.text === "function"
			) {
				diff = await diffResult.text();
			} else {
				const resolved = await diffResult;
				diff =
					typeof resolved === "string"
						? resolved
						: typeof resolved === "object" &&
								resolved !== null &&
								"text" in resolved &&
								typeof resolved.text === "function"
							? await resolved.text()
							: String(resolved);
			}

			// Check if there are any changes
			if (!diff || diff.trim().length === 0) {
				stdout("No changes to commit.");
				return 0;
			}

			// Generate commit message using AI
			stdout("🤖 Generating commit message...");
			const generatedMessage = await generateCommitMessage(diff);

			// Print the generated message
			stdout(`\n📝 Generated commit message:\n   ${generatedMessage}\n`);

			// Ask for confirmation unless --no-confirm flag is set
			let commitMessage: string | null = generatedMessage;
			if (!noConfirm) {
				commitMessage = await promptCommitMessage(generatedMessage);
			}

			if (!commitMessage) {
				p.cancel("Commit cancelled.");
				return 0;
			}

			// Commit with the message (original or edited)
			await run`git commit -m ${commitMessage}`;
			stdout(`✅ Commit created: ${commitMessage}`);

			return 0;
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes("OPENROUTER_API_KEY")) {
					stderr(`❌ ${error.message}`);
					stderr("Please set OPENROUTER_API_KEY environment variable.");
				} else if (error.message.includes("OpenRouter API error")) {
					stderr(`❌ ${error.message}`);
				} else {
					stderr(`❌ Failed to create commit: ${error.message}`);
				}
			} else {
				stderr(`❌ Failed to create commit: ${String(error)}`);
			}
			return 1;
		}
	},
};
