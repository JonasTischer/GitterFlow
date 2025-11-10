import { createInterface } from "node:readline";
import { $ } from "bun";
import type { CommandDefinition } from "./types";
import { getSetting } from "../config";

/**
 * Get the configured OpenRouter model from environment variable or config file
 * Defaults to "qwen/qwen3-235b-a22b-2507" if not configured
 */
const _aiModel = getSetting("ai_model");

/**
 * Prompt user for confirmation
 */
async function promptConfirmation(
	message: string,
	_stdout: (msg: string) => void,
): Promise<boolean> {
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise((resolve) => {
		rl.question(message, (answer) => {
			rl.close();
			const confirmed =
				answer.toLowerCase().trim() === "y" ||
				answer.toLowerCase().trim() === "yes";
			resolve(confirmed);
		});
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
			const commitMessage = await generateCommitMessage(diff);

			// Print the generated message
			stdout(`\n📝 Generated commit message:\n   ${commitMessage}\n`);

			// Ask for confirmation unless --no-confirm flag is set
			let confirmed = noConfirm;
			if (!noConfirm) {
				confirmed = await promptConfirmation(
					"Commit with this message? [y/N] ",
					stdout,
				);
			}

			if (!confirmed) {
				stdout("Commit cancelled.");
				return 0;
			}

			// Commit with the generated message
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
