import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { writeAgentState } from "../utils/agent-state";
import { preTrustWorktree } from "../utils/claude-trust";
import { createSymlinks } from "../utils/symlink";
import { spawnTerminal } from "../utils/terminal";
import type { CommandContext, CommandDefinition } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: Shell runner type is complex
type ShellRunner = any;

/**
 * Extended context with optional rootDir for testing
 */
type NewCommandContext = CommandContext & {
	rootDir?: string;
};

/**
 * Check for uncommitted changes in the working directory
 * Returns the git status output if there are changes
 */
async function getUncommittedChanges(run: ShellRunner): Promise<string | null> {
	const statusResult = run`git status --porcelain`;

	let status: string;
	if (
		typeof statusResult === "object" &&
		statusResult !== null &&
		"text" in statusResult &&
		typeof statusResult.text === "function"
	) {
		status = await statusResult.text();
	} else {
		const resolved = await statusResult;
		status =
			typeof resolved === "string"
				? resolved
				: typeof resolved === "object" &&
						resolved !== null &&
						"text" in resolved &&
						typeof resolved.text === "function"
					? await resolved.text()
					: String(resolved);
	}

	const trimmed = status.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Create a WIP commit with all uncommitted changes
 */
async function createWipCommit(
	stdout: (msg: string) => void,
	run: ShellRunner,
): Promise<void> {
	await run`git add -A`;
	const message = "wip: checkpoint before worktree creation";
	await run`git commit -m ${message}`;
	stdout(`📦 Created WIP commit: "${message}"`);
}

/**
 * Prompt user for how to handle uncommitted changes
 * Returns: 'commit' | 'ignore' | 'cancel'
 */
async function promptUncommittedChanges(
	changes: string,
	stdout: (msg: string) => void,
): Promise<"commit" | "ignore" | "cancel"> {
	stdout(
		"\n⚠️  You have uncommitted changes that won't be in the new worktree:",
	);
	// Show first 10 lines of changes
	const lines = changes.split("\n").slice(0, 10);
	for (const line of lines) {
		stdout(`   ${line}`);
	}
	if (changes.split("\n").length > 10) {
		stdout(`   ... and ${changes.split("\n").length - 10} more files`);
	}
	stdout("");
	stdout("  Options:");
	stdout("  • [c] Create WIP commit and continue");
	stdout("  • [i] Ignore and continue (changes won't be in worktree)");
	stdout("  • [n] Cancel");
	stdout("");

	// Set stdin to raw mode to capture single key presses
	const wasRaw = process.stdin.isRaw;
	if (!wasRaw && process.stdin.setRawMode) {
		process.stdin.setRawMode(true);
	}
	process.stdin.resume();
	process.stdin.setEncoding("utf8");

	return new Promise((resolve) => {
		const onData = (key: string) => {
			// Handle Ctrl+C
			if (key === "\u0003") {
				if (process.stdin.setRawMode) {
					process.stdin.setRawMode(wasRaw);
				}
				process.stdin.pause();
				process.stdin.removeListener("data", onData);
				resolve("cancel");
				return;
			}

			const lowerKey = key.toLowerCase().trim();

			// Restore stdin
			if (process.stdin.setRawMode) {
				process.stdin.setRawMode(wasRaw);
			}
			process.stdin.pause();
			process.stdin.removeListener("data", onData);

			if (lowerKey === "c") {
				stdout("  → Creating WIP commit\n");
				resolve("commit");
			} else if (lowerKey === "i") {
				stdout("  → Continuing without uncommitted changes\n");
				resolve("ignore");
			} else if (lowerKey === "n" || lowerKey === "\u001b") {
				stdout("  → Cancelled\n");
				resolve("cancel");
			} else {
				// Invalid key, default to cancel for safety
				stdout(`  → Invalid key '${key}', cancelling\n`);
				resolve("cancel");
			}
		};

		process.stdin.once("data", onData);
	});
}

/**
 * Parse command line arguments
 * Returns { branch, task, force, autonomous, planFirst, headless }
 * --force or -f: auto-create WIP commit if uncommitted changes exist
 * --autonomous or -a: track agent state and instruct to run gf finish
 * --plan-first or -p: start in plan mode, require brain approval before execution
 * --headless or -H: skip terminal/IDE spawning, output JSON (for CI/server/orchestrators)
 */
function parseArgs(args: string[]): {
	branch?: string;
	task?: string;
	force?: boolean;
	autonomous?: boolean;
	planFirst?: boolean;
	headless?: boolean;
} {
	let branch: string | undefined;
	let task: string | undefined;
	let force = false;
	let autonomous = false;
	let planFirst = false;
	let headless = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--task" || arg === "-t") {
			// Next argument is the task
			task = args[i + 1];
			i++; // Skip the task value
		} else if (arg === "--force" || arg === "-f") {
			force = true;
		} else if (arg === "--autonomous" || arg === "-a") {
			autonomous = true;
		} else if (arg === "--plan-first" || arg === "-p") {
			planFirst = true;
		} else if (arg === "--headless" || arg === "-H") {
			headless = true;
		} else if (!arg.startsWith("-")) {
			// Non-flag argument is the branch name
			if (!branch) {
				branch = arg;
			}
		}
	}

	return { branch, task, force, autonomous, planFirst, headless };
}

/**
 * Build the agent command with optional task
 * If task is provided, appends it as an initial prompt: claude "task"
 * For Claude, adds:
 *   --permission-mode acceptEdits to auto-accept edits (normal mode)
 *   --permission-mode plan for plan-first mode (read-only analysis)
 *   --append-system-prompt with finish instruction (when autonomous)
 */
function buildAgentCommand(
	baseCommand: string,
	task?: string,
	options?: { autonomous?: boolean; planFirst?: boolean; branch?: string },
): string {
	// For claude, add permission mode flag
	const isClaude =
		baseCommand === "claude" || baseCommand.startsWith("claude ");

	if (!isClaude) {
		// For non-claude agents, just append the task if provided
		if (!task) return baseCommand;
		const escapedTask = task.replace(/"/g, '\\"');
		return `${baseCommand} "${escapedTask}"`;
	}

	// Build Claude command with flags
	const flags: string[] = [];

	if (options?.planFirst) {
		// Plan mode: read-only analysis, write plan, then exit
		flags.push("--permission-mode plan");

		const planPath = `.gitterflow/agents/${options.branch || "agent"}/plan.md`;
		const planSystemPrompt = `You are in PLAN mode. Your task:

1. Analyze the codebase to understand what needs to be done
2. Write a detailed implementation plan to: ${planPath}
3. Run: gf status --write "awaiting_approval"
4. Exit immediately (do not implement anything)

Plan format:
## Analysis
What you found in the codebase

## Approach
How you'll implement the task

## Files to Modify
List of files and changes needed

## Files to Create
New files if needed

## Risks
Potential issues to watch for

## Questions
Anything needing clarification`;

		flags.push(
			`--append-system-prompt "${planSystemPrompt.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`,
		);
	} else {
		flags.push("--permission-mode acceptEdits");

		// Add system prompt for autonomous mode
		if (options?.autonomous) {
			const systemPrompt =
				"When you complete this task, use the gitterflow skill to finish and merge your changes back to the base branch.";
			flags.push(`--append-system-prompt "${systemPrompt}"`);
		}
	}

	// Build final command
	if (!task) {
		return `claude ${flags.join(" ")}`;
	}

	const escapedTask = task.replace(/"/g, '\\"');
	return `claude ${flags.join(" ")} "${escapedTask}"`;
}

/**
 * Generate a random branch name
 * Format: worktree-{adjective}-{noun}-{random-number}
 */
function generateRandomBranchName(): string {
	const adjectives = [
		"quick",
		"bright",
		"clever",
		"happy",
		"swift",
		"bold",
		"calm",
		"wise",
		"proud",
		"cool",
	];
	const nouns = [
		"fox",
		"wolf",
		"bear",
		"eagle",
		"tiger",
		"lion",
		"hawk",
		"owl",
		"falcon",
		"dragon",
	];

	const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const randomNum = Math.floor(Math.random() * 1000);

	return `worktree-${adjective}-${noun}-${randomNum}`;
}

export const newCommand: CommandDefinition & {
	run: (context: NewCommandContext) => Promise<number>;
} = {
	name: "new",
	description:
		"Create a git worktree (optionally specify branch name and task)",
	usage:
		"gitterflow new [branch] [--task <prompt>] [--force] [--autonomous] [--plan-first] [--headless]",
	run: async ({ args, stderr, stdout, exec, rootDir }: NewCommandContext) => {
		// Parse arguments for branch name, task, force, autonomous, planFirst, and headless flags
		const { branch, task, force, autonomous, planFirst, headless } =
			parseArgs(args);

		// --plan-first mode: agent analyzes and writes plan, then waits for approval
		// Brain reviews plan, uses "gf approve" or "gf reject" to control execution
		// See docs/PLAN-APPROVAL-DESIGN.md for full design
		const run = exec ?? $;

		// Check for uncommitted changes
		const uncommittedChanges = await getUncommittedChanges(run);
		if (uncommittedChanges) {
			// Skip interactive prompt in CI/test environments
			const isNonInteractive =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (force) {
				// --force flag: auto-create WIP commit
				await createWipCommit(stdout, run);
			} else if (isNonInteractive) {
				// Non-interactive: just warn and continue
				stdout(
					"⚠️  Uncommitted changes detected (continuing without them in non-interactive mode)",
				);
			} else {
				// Interactive: prompt user
				const choice = await promptUncommittedChanges(
					uncommittedChanges,
					stdout,
				);
				if (choice === "cancel") {
					stdout("Cancelled.");
					return 0;
				}
				if (choice === "commit") {
					await createWipCommit(stdout, run);
				}
				// choice === 'ignore': continue without committing
			}
		}

		// Generate random branch name if none provided or if empty/whitespace
		const trimmedBranch =
			branch && branch.trim() !== ""
				? branch.trim()
				: generateRandomBranchName();

		try {
			// Get the current branch (this will be the base branch for the new worktree)
			const currentBranchResult = run`git rev-parse --abbrev-ref HEAD`;

			// First await the result to handle Promises
			const awaitedResult = await currentBranchResult;

			let currentBranch: string;
			if (
				typeof awaitedResult === "object" &&
				awaitedResult !== null &&
				"text" in awaitedResult &&
				typeof awaitedResult.text === "function"
			) {
				currentBranch = (await awaitedResult.text()).trim();
			} else {
				currentBranch =
					typeof awaitedResult === "string"
						? awaitedResult.trim()
						: String(awaitedResult).trim();
			}

			// Use -b flag to create a new branch in the worktree
			// This creates the branch from current HEAD (base branch)
			// git worktree add -b <branch-name> <path>
			const worktreePath = `../${trimmedBranch}`;
			await run`git worktree add -b ${trimmedBranch} ${worktreePath}`;

			// Store the base branch information in git config for this branch
			// This allows finish command to know which branch to merge into
			await run`git config branch.${trimmedBranch}.gitterflow-base-branch ${currentBranch}`;

			// Resolve to absolute paths
			const absoluteWorktreePath = resolve(worktreePath);
			const absoluteMainRepoPath = process.cwd();

			// Create symlinks for configured files/directories
			const symlinkFiles = getSetting("symlink_files");
			if (symlinkFiles.length > 0) {
				createSymlinks(
					absoluteMainRepoPath,
					absoluteWorktreePath,
					symlinkFiles,
				);
			}

			// Pre-trust the worktree in Claude Code's config
			// This prevents the "Do you trust this folder?" dialog when opening the worktree
			try {
				await preTrustWorktree(absoluteWorktreePath);
			} catch {
				// If pre-trusting fails (e.g., no Claude config), continue anyway
				// User will just see the trust dialog once
			}

			// Write initial agent state if autonomous or plan-first mode
			if (autonomous || planFirst) {
				const now = new Date().toISOString();
				const planPath = planFirst
					? `.gitterflow/agents/${trimmedBranch}/plan.md`
					: undefined;
				await writeAgentState(
					{
						branch: trimmedBranch,
						task: task ?? "No task specified",
						status: "pending",
						started_at: now,
						spawned_at: now,
						worktree_path: absoluteWorktreePath,
						base_branch: currentBranch,
						plan_file: planPath,
					},
					rootDir,
				);
			}

			// Build the agent command for reference
			const baseAgentCommand = getSetting("coding_agent");
			const agentCommand = buildAgentCommand(baseAgentCommand, task, {
				autonomous,
				planFirst,
				branch: trimmedBranch,
			});

			// Headless mode: output JSON and exit (no terminal/IDE spawning)
			// Useful for CI/CD pipelines, server-side orchestrators, and Clawdbot integration
			if (headless) {
				const result = {
					success: true,
					branch: trimmedBranch,
					worktree: absoluteWorktreePath,
					baseBranch: currentBranch,
					task: task ?? null,
					autonomous,
					planFirst,
					agentCommand,
				};
				stdout(JSON.stringify(result));
				return 0;
			}

			// Output informative messages
			stdout(`✅ Created worktree for branch ${trimmedBranch}`);
			stdout(`📁 Switched to: ${absoluteWorktreePath}`);

			// Spawn a new terminal window/tab in the worktree directory and run coding agent
			// Skip terminal spawning in CI/test environments where it's not useful
			const skipTerminalSpawn =
				process.env.CI === "true" || process.env.NODE_ENV === "test";

			if (!skipTerminalSpawn) {
				try {
					const ide = getSetting("ide");
					const openTerminal = getSetting("open_terminal");

					spawnTerminal(absoluteWorktreePath, agentCommand);

					// Show appropriate messages based on what was opened
					const messages: string[] = [];
					if (ide) {
						messages.push(`🚀 Opened ${ide} in worktree directory`);
					}
					if (openTerminal) {
						messages.push(`🚀 Opened new terminal in worktree directory`);
					}
					if (messages.length > 0) {
						for (const msg of messages) {
							stdout(msg);
						}
						stdout(`🤖 Running coding agent: ${agentCommand}`);
					}
				} catch {
					// If spawning fails, fall back to outputting commands
					stdout(`cd ${absoluteWorktreePath}`);
					stdout(`${agentCommand}`);
					stderr(
						`⚠️  Could not open new terminal automatically. Run: cd ${absoluteWorktreePath} && ${agentCommand}`,
					);
				}
			} else {
				// In test/CI environment, just output the commands
				stdout(`cd ${absoluteWorktreePath}`);
				stdout(`${agentCommand}`);
			}

			return 0;
		} catch (error) {
			// Handle git errors gracefully
			stderr(
				`❌ Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
