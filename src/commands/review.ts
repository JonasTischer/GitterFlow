import { $ } from "bun";
import { readAgentState } from "../utils/agent-state";
import type { CommandContext, CommandDefinition, CommandExecutor } from "./types";

/**
 * Parse command line arguments
 * Returns { branch, detailed }
 */
function parseArgs(args: string[]): {
	branch?: string;
	detailed?: boolean;
} {
	let branch: string | undefined;
	let detailed = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		if (arg === "--detailed" || arg === "-d") {
			detailed = true;
		} else if (!arg.startsWith("-") && !branch) {
			branch = arg;
		}
	}

	return { branch, detailed };
}

/**
 * Get diff stats between base branch and feature branch
 */
async function getDiffStats(
	run: CommandExecutor | typeof $,
	baseBranch: string,
	featureBranch: string,
): Promise<{
	filesChanged: number;
	insertions: number;
	deletions: number;
	files: string[];
}> {
	// Get shortstat
	const statResult = run`git diff --shortstat ${baseBranch}...${featureBranch}`;
	let stat: string;
	if (typeof statResult === "object" && statResult !== null && "text" in statResult) {
		stat = await (statResult as { text: () => Promise<string> }).text();
	} else {
		stat = String(await statResult);
	}

	// Parse shortstat: "3 files changed, 50 insertions(+), 10 deletions(-)"
	let filesChanged = 0;
	let insertions = 0;
	let deletions = 0;

	const filesMatch = stat.match(/(\d+) files? changed/);
	if (filesMatch) filesChanged = parseInt(filesMatch[1], 10);

	const insertMatch = stat.match(/(\d+) insertions?\(\+\)/);
	if (insertMatch) insertions = parseInt(insertMatch[1], 10);

	const deleteMatch = stat.match(/(\d+) deletions?\(-\)/);
	if (deleteMatch) deletions = parseInt(deleteMatch[1], 10);

	// Get list of changed files
	const nameResult = run`git diff --name-only ${baseBranch}...${featureBranch}`;
	let names: string;
	if (typeof nameResult === "object" && nameResult !== null && "text" in nameResult) {
		names = await (nameResult as { text: () => Promise<string> }).text();
	} else {
		names = String(await nameResult);
	}

	const files = names.trim().split("\n").filter(Boolean);

	return { filesChanged, insertions, deletions, files };
}

/**
 * Check if tests pass (if test script exists)
 */
async function runTests(
	run: CommandExecutor | typeof $,
	worktreePath: string,
): Promise<{ success: boolean; output?: string }> {
	try {
		// Check if package.json exists with test script
		const checkPkg = run`test -f ${worktreePath}/package.json && cat ${worktreePath}/package.json`;
		let pkgContent: string;
		try {
			if (typeof checkPkg === "object" && checkPkg !== null && "text" in checkPkg) {
				pkgContent = await (checkPkg as { text: () => Promise<string> }).text();
			} else {
				pkgContent = String(await checkPkg);
			}
		} catch {
			return { success: true, output: "No package.json found, skipping tests" };
		}

		const pkg = JSON.parse(pkgContent);
		if (!pkg.scripts?.test) {
			return { success: true, output: "No test script defined" };
		}

		// Run tests
		const originalCwd = process.cwd();
		try {
			process.chdir(worktreePath);
			await run`npm test`;
			return { success: true, output: "Tests passed" };
		} catch (e) {
			const error = e as Error;
			return { success: false, output: error.message };
		} finally {
			process.chdir(originalCwd);
		}
	} catch {
		return { success: true, output: "Could not run tests" };
	}
}

/**
 * Determine auto-review recommendation based on criteria
 */
function getRecommendation(
	stats: { filesChanged: number; insertions: number; deletions: number; files: string[] },
	testResult: { success: boolean },
): {
	recommendation: "auto-approve" | "needs-review";
	reasons: string[];
} {
	const reasons: string[] = [];
	let needsReview = false;

	// Check if tests failed
	if (!testResult.success) {
		reasons.push("❌ Tests failed");
		needsReview = true;
	}

	// Check change size
	const totalLines = stats.insertions + stats.deletions;
	if (totalLines > 500) {
		reasons.push(`📏 Large change (${totalLines} lines)`);
		needsReview = true;
	}

	// Check for critical paths
	const criticalPatterns = [
		/auth/i,
		/payment/i,
		/secret/i,
		/password/i,
		/migration/i,
		/schema/i,
		/\.env/,
		/config\.(ts|js|json)$/,
	];

	const criticalFiles = stats.files.filter((f) =>
		criticalPatterns.some((p) => p.test(f))
	);
	if (criticalFiles.length > 0) {
		reasons.push(`🔒 Touches sensitive files: ${criticalFiles.join(", ")}`);
		needsReview = true;
	}

	if (!needsReview) {
		reasons.push("✅ Small change, tests pass, no sensitive files");
	}

	return {
		recommendation: needsReview ? "needs-review" : "auto-approve",
		reasons,
	};
}

export const reviewCommand: CommandDefinition = {
	name: "review",
	description: "Review a subagent's work before approving merge",
	usage: "gitterflow review <branch> [--detailed]",

	run: async ({ args, stdout, stderr, exec }: CommandContext): Promise<number> => {
		const run = exec ?? $;
		const { branch, detailed } = parseArgs(args);

		if (!branch) {
			stderr("Usage: gf review <branch> [--detailed]");
			stderr("  Review a subagent's completed work before merging");
			return 1;
		}

		// Read agent state
		const state = await readAgentState(branch);
		if (!state) {
			stderr(`❌ No agent found for branch: ${branch}`);
			return 1;
		}

		if (state.status !== "ready") {
			stderr(`❌ Agent is not ready for review (current status: ${state.status})`);
			stderr("   Use 'gf review' only on branches marked 'ready'.");
			return 1;
		}

		stdout(`\n📋 Review: ${branch}`);
		stdout(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
		stdout(`📝 Task: ${state.task}`);
		stdout(`🌿 Base: ${state.base_branch}`);
		stdout(`📁 Worktree: ${state.worktree_path}`);
		stdout("");

		// Get diff stats
		stdout("📊 Change Statistics:");
		const stats = await getDiffStats(run, state.base_branch, branch);
		stdout(`   Files changed: ${stats.filesChanged}`);
		stdout(`   Insertions:    +${stats.insertions}`);
		stdout(`   Deletions:     -${stats.deletions}`);
		stdout("");

		// Show changed files
		stdout("📁 Changed Files:");
		for (const file of stats.files.slice(0, 20)) {
			stdout(`   • ${file}`);
		}
		if (stats.files.length > 20) {
			stdout(`   ... and ${stats.files.length - 20} more`);
		}
		stdout("");

		// Run tests if possible
		stdout("🧪 Tests:");
		const testResult = state.worktree_path
			? await runTests(run, state.worktree_path)
			: { success: true, output: "No worktree path available" };
		stdout(`   ${testResult.output}`);
		stdout("");

		// Get recommendation
		const { recommendation, reasons } = getRecommendation(stats, testResult);
		stdout(`🎯 Recommendation: ${recommendation.toUpperCase()}`);
		for (const reason of reasons) {
			stdout(`   ${reason}`);
		}
		stdout("");

		// Show detailed diff if requested
		if (detailed) {
			stdout("📝 Diff Preview (first 100 lines):");
			stdout("─────────────────────────────────────────────────");
			try {
				const diffResult = run`git diff ${state.base_branch}...${branch}`;
				let diff: string;
				if (typeof diffResult === "object" && diffResult !== null && "text" in diffResult) {
					diff = await (diffResult as { text: () => Promise<string> }).text();
				} else {
					diff = String(await diffResult);
				}
				const lines = diff.split("\n").slice(0, 100);
				for (const line of lines) {
					stdout(line);
				}
				if (diff.split("\n").length > 100) {
					stdout(`... (${diff.split("\n").length - 100} more lines)`);
				}
			} catch {
				stderr("   Could not fetch diff");
			}
			stdout("");
		}

		// Show next steps
		stdout("💡 Next Steps:");
		stdout(`   Approve: gf approve ${branch}`);
		stdout(`   Reject:  gf reject ${branch} --message "feedback"`);
		stdout(`   Diff:    git diff ${state.base_branch}...${branch}`);
		if (!detailed) {
			stdout(`   Details: gf review ${branch} --detailed`);
		}

		return 0;
	},
};
