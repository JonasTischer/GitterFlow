import { resolve } from "node:path";
import { $ } from "bun";
import { getSetting } from "../config";
import { writeAgentState } from "../utils/agent-state";
import { preTrustWorktree } from "../utils/claude-trust";
import { createSymlinks } from "../utils/symlink";
import { spawnTerminal } from "../utils/terminal";
import type { CommandContext, CommandDefinition } from "./types";

/**
 * Parse spawn arguments
 * Supports:
 *   gf spawn "task1" "task2" "task3"
 *   gf spawn --file tasks.txt
 *   gf spawn --plan-first "task1" "task2"
 */
function parseArgs(args: string[]): {
	tasks: string[];
	planFirst: boolean;
	file?: string;
	delay: number;
} {
	const tasks: string[] = [];
	let planFirst = false;
	let file: string | undefined;
	let delay = 2000; // 2 second delay between spawns

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--plan-first" || arg === "-p") {
			planFirst = true;
		} else if (arg === "--file" || arg === "-f") {
			file = args[i + 1];
			i++;
		} else if (arg === "--delay" || arg === "-d") {
			delay = parseInt(args[i + 1] || "2000", 10);
			i++;
		} else if (!arg.startsWith("-")) {
			tasks.push(arg);
		}
	}

	return { tasks, planFirst, file, delay };
}

/**
 * Generate a branch name from a task description
 */
function taskToBranchName(task: string): string {
	// Take first few words, lowercase, replace spaces with dashes
	const slug = task
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.split(/\s+/)
		.slice(0, 4)
		.join("-");

	const randomSuffix = Math.floor(Math.random() * 1000);
	return `agent-${slug}-${randomSuffix}`;
}

/**
 * Read tasks from a file (one task per line)
 */
async function readTasksFromFile(filePath: string): Promise<string[]> {
	const file = Bun.file(filePath);
	if (!(await file.exists())) {
		throw new Error(`Task file not found: ${filePath}`);
	}

	const content = await file.text();
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const spawnCommand: CommandDefinition = {
	name: "spawn",
	description: "Spawn multiple agents in parallel from a list of tasks",
	usage:
		'gitterflow spawn "task1" "task2" [--plan-first] [--file tasks.txt] [--delay ms]',

	run: async ({ args, stdout, stderr }: CommandContext): Promise<number> => {
		const { tasks: cliTasks, planFirst, file, delay } = parseArgs(args);

		// Collect tasks from CLI args and/or file
		let tasks = [...cliTasks];

		if (file) {
			try {
				const fileTasks = await readTasksFromFile(file);
				tasks = [...tasks, ...fileTasks];
			} catch (error) {
				stderr(`❌ ${error instanceof Error ? error.message : String(error)}`);
				return 1;
			}
		}

		if (tasks.length === 0) {
			stderr(
				"Usage: gf spawn <task1> <task2> ... [--plan-first] [--file tasks.txt]",
			);
			stderr("");
			stderr("Examples:");
			stderr('  gf spawn "Add login page" "Add user settings" "Fix bug #123"');
			stderr("  gf spawn --file backlog.txt --plan-first");
			stderr('  gf spawn --plan-first "Feature A" "Feature B"');
			return 1;
		}

		stdout(
			`🚀 Spawning ${tasks.length} agent${tasks.length > 1 ? "s" : ""}...`,
		);
		if (planFirst) {
			stdout("   Mode: plan-first (agents will write plans for approval)");
		}
		stdout("");

		const run = $;
		const spawned: string[] = [];
		const failed: string[] = [];

		// Get current branch for base
		let currentBranch: string;
		try {
			const result = await run`git rev-parse --abbrev-ref HEAD`;
			currentBranch = (await result.text()).trim();
		} catch {
			stderr("❌ Failed to get current branch. Are you in a git repository?");
			return 1;
		}

		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i]!;
			const branchName = taskToBranchName(task);

			stdout(`[${i + 1}/${tasks.length}] ${task}`);
			stdout(`   Branch: ${branchName}`);

			try {
				// Create worktree
				const worktreePath = `../${branchName}`;
				await run`git worktree add -b ${branchName} ${worktreePath}`;

				// Store base branch
				await run`git config branch.${branchName}.gitterflow-base-branch ${currentBranch}`;

				const absoluteWorktreePath = resolve(worktreePath);

				// Symlinks
				const symlinkFiles = getSetting("symlink_files");
				if (symlinkFiles.length > 0) {
					createSymlinks(process.cwd(), absoluteWorktreePath, symlinkFiles);
				}

				// Pre-trust
				try {
					await preTrustWorktree(absoluteWorktreePath);
				} catch {
					// Ignore trust errors
				}

				// Write agent state
				const now = new Date().toISOString();
				const planPath = planFirst
					? `.gitterflow/agents/${branchName}/plan.md`
					: undefined;

				await writeAgentState({
					branch: branchName,
					task,
					status: "pending",
					started_at: now,
					spawned_at: now,
					worktree_path: absoluteWorktreePath,
					base_branch: currentBranch,
					plan_file: planPath,
				});

				// Spawn terminal with agent
				const skipTerminalSpawn =
					process.env.CI === "true" || process.env.NODE_ENV === "test";

				if (!skipTerminalSpawn) {
					const baseAgentCommand = getSetting("coding_agent");
					const isClaude =
						baseAgentCommand === "claude" ||
						baseAgentCommand.startsWith("claude ");

					let agentCommand: string;
					if (isClaude) {
						const escapedTask = task.replace(/"/g, '\\"');
						if (planFirst) {
							const planSystemPrompt = `You are in PLAN mode. Analyze and write a plan to .gitterflow/agents/${branchName}/plan.md, then run 'gf status --write awaiting_approval' and exit.`;
							agentCommand = `claude --permission-mode plan --append-system-prompt "${planSystemPrompt}" "${escapedTask}"`;
						} else {
							const systemPrompt =
								"When you complete this task, run 'gf finish' to merge your changes.";
							agentCommand = `claude --permission-mode acceptEdits --append-system-prompt "${systemPrompt}" "${escapedTask}"`;
						}
					} else {
						const escapedTask = task.replace(/"/g, '\\"');
						agentCommand = `${baseAgentCommand} "${escapedTask}"`;
					}

					try {
						spawnTerminal(absoluteWorktreePath, agentCommand);
					} catch {
						// Terminal spawn failed, but worktree was created
						stderr(`   ⚠️  Could not spawn terminal for ${branchName}`);
					}
				}

				spawned.push(branchName);
				stdout(`   ✅ Spawned`);

				// Delay between spawns to avoid overwhelming the system
				if (i < tasks.length - 1 && delay > 0) {
					await sleep(delay);
				}
			} catch (error) {
				failed.push(branchName);
				stderr(
					`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			stdout("");
		}

		// Summary
		stdout("─".repeat(50));
		stdout(
			`✅ Spawned: ${spawned.length} agent${spawned.length !== 1 ? "s" : ""}`,
		);
		if (failed.length > 0) {
			stdout(`❌ Failed: ${failed.length}`);
		}
		stdout("");
		stdout("Monitor progress with: gf status");
		if (planFirst) {
			stdout("Review plans with: gf approve <branch> or gf reject <branch>");
		}

		return failed.length > 0 ? 1 : 0;
	},
};
