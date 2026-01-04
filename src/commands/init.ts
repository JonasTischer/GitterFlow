import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { stringify } from "yaml";
import { scanForSymlinkCandidates } from "../utils/scanner";
import type { CommandDefinition } from "./types";

interface Config {
	base_branch: string;
	worktrees_dir: string;
	ai_model: string;
	open_terminal: boolean;
	delete_remote_on_finish: boolean;
	ide: string | null;
	symlink_files: string[];
}

type ShellType = "zsh" | "bash" | "fish" | "unknown";

interface ShellConfig {
	type: ShellType;
	configFile: string;
	aliasFormat: (alias: string, command: string) => string;
}

/**
 * Detect the user's shell and return configuration
 */
function detectShell(): ShellConfig {
	const shellEnv = process.env.SHELL || "";
	const homeDir = homedir();

	// Extract shell name from path (e.g., /bin/zsh -> zsh)
	const shellName = shellEnv.split("/").pop()?.toLowerCase() || "";

	if (shellName.includes("zsh")) {
		return {
			type: "zsh",
			configFile: join(homeDir, ".zshrc"),
			aliasFormat: (alias, command) => `alias ${alias}="${command}"`,
		};
	}

	if (shellName.includes("bash")) {
		return {
			type: "bash",
			configFile: join(homeDir, ".bashrc"),
			aliasFormat: (alias, command) => `alias ${alias}="${command}"`,
		};
	}

	if (shellName.includes("fish")) {
		return {
			type: "fish",
			configFile: join(homeDir, ".config", "fish", "config.fish"),
			aliasFormat: (alias, command) => `alias ${alias}="${command}"`,
		};
	}

	// Default to bash if unknown
	return {
		type: "unknown",
		configFile: join(homeDir, ".bashrc"),
		aliasFormat: (alias, command) => `alias ${alias}="${command}"`,
	};
}

/**
 * Check if an alias already exists in the shell config file
 */
function aliasExists(configFile: string, alias: string): boolean {
	if (!existsSync(configFile)) {
		return false;
	}

	try {
		const content = readFileSync(configFile, "utf-8");
		// Check for various alias patterns:
		// - alias gf="gitterflow"
		// - alias gf='gitterflow'
		// - alias gf=gitterflow
		// - alias gf = "gitterflow" (with spaces)
		// - alias gf gitterflow (fish shell format)
		const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const patterns = [
			// Standard format: alias name="command" or alias name='command'
			new RegExp(`^\\s*alias\\s+${escapedAlias}\\s*=\\s*["']`, "m"),
			// Format without quotes: alias name=command
			new RegExp(`^\\s*alias\\s+${escapedAlias}\\s*=\\s*\\S`, "m"),
			// Fish shell format: alias name command
			new RegExp(`^\\s*alias\\s+${escapedAlias}\\s+\\S`, "m"),
		];

		return patterns.some((pattern) => pattern.test(content));
	} catch {
		return false;
	}
}

/**
 * Add shell alias to the appropriate config file
 */
async function addShellAlias(
	alias: string,
	command: string,
	shellConfig: ShellConfig,
	stdout: (msg: string) => void,
	stderr: (msg: string) => void,
): Promise<boolean> {
	const { configFile, aliasFormat } = shellConfig;

	// Check if alias already exists
	if (aliasExists(configFile, alias)) {
		stdout(`⚠️  Alias "${alias}" already exists in ${configFile}`);
		return false;
	}

	try {
		// Ensure the directory exists (especially for fish)
		const configDir = resolve(configFile, "..");
		if (!existsSync(configDir)) {
			mkdirSync(configDir, { recursive: true });
		}

		// Append alias to config file
		const aliasLine = aliasFormat(alias, command);
		const content = `\n# GitterFlow alias\n${aliasLine}\n`;

		if (existsSync(configFile)) {
			appendFileSync(configFile, content, "utf-8");
		} else {
			writeFileSync(configFile, content, "utf-8");
		}

		stdout(`✅ Added alias "${alias}" to ${configFile}`);
		stdout(`   Run: source ${configFile}  (or restart your terminal)`);

		return true;
	} catch (error) {
		stderr(
			`❌ Failed to add alias: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

export const initCommand: CommandDefinition = {
	name: "init",
	description: "Initialize GitterFlow configuration file",
	usage: "gitterflow init",
	run: async ({ stdout, stderr }) => {
		const configPath = resolve(".gitterflow.yaml");

		// Check if config file already exists
		if (existsSync(configPath)) {
			const shouldOverwrite = await p.confirm({
				message: ".gitterflow.yaml already exists. Overwrite it?",
				initialValue: false,
			});

			if (p.isCancel(shouldOverwrite) || !shouldOverwrite) {
				stdout("Initialization cancelled.");
				return 0;
			}
		}

		// Start the interactive wizard
		p.intro("🚀 GitterFlow Configuration Setup");

		// Ask for default base branch
		const baseBranch = await p.text({
			message: "Default base branch?",
			initialValue: "main",
			placeholder: "main",
		});

		if (p.isCancel(baseBranch)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		// Ask for worktrees directory path
		const worktreesDir = await p.text({
			message: "Worktrees directory path?",
			initialValue: "../worktrees",
			placeholder: "../worktrees",
		});

		if (p.isCancel(worktreesDir)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		// Ask for default AI model
		const aiModel = await p.text({
			message: "Default AI model?",
			initialValue: "google/gemini-3-flash-preview",
			placeholder: "google/gemini-3-flash-preview",
		});

		if (p.isCancel(aiModel)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		// Ask whether to auto-open new terminals
		const openTerminal = await p.confirm({
			message: "Auto-open new terminals after creating a worktree?",
			initialValue: true,
		});

		if (p.isCancel(openTerminal)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		// Ask about IDE preference (right after terminal question)
		const useIDE = await p.confirm({
			message: "Open IDE after creating a worktree? (e.g., Cursor, VS Code)",
			initialValue: false,
		});

		if (p.isCancel(useIDE)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		let ideName: string | null = null;
		if (useIDE) {
			const ide = await p.select({
				message: "Which IDE?",
				options: [
					{ value: "cursor", label: "Cursor" },
					{ value: "code", label: "VS Code" },
					{ value: "custom", label: "Custom (enter name)" },
				],
			});

			if (p.isCancel(ide)) {
				p.cancel("Initialization cancelled.");
				return 0;
			}

			if (ide === "custom") {
				const customIDE = await p.text({
					message: "IDE name or command?",
					placeholder: "cursor, code, etc.",
				});

				if (p.isCancel(customIDE)) {
					p.cancel("Initialization cancelled.");
					return 0;
				}

				ideName = customIDE?.trim() || null;
			} else {
				ideName = ide;
			}
		}

		// Ask about symlink files
		const useSymlinks = await p.confirm({
			message:
				"Automatically symlink files/directories to worktrees? (e.g., .env, node_modules)",
			initialValue: false,
		});

		if (p.isCancel(useSymlinks)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		let symlinkFiles: string[] = [];
		if (useSymlinks) {
			// Scan the current repository for symlink candidates
			const repoRoot = process.cwd();
			const candidates = scanForSymlinkCandidates(repoRoot);

			if (candidates.length === 0) {
				stdout(
					"⚠️  No symlink candidates found in your repository (no .env, node_modules, .venv, etc.)",
				);
				stdout(
					"   You can manually add files to symlink_files in .gitterflow.yaml later.",
				);
			} else {
				// Show found candidates for selection
				const options = candidates.map((path) => ({
					value: path,
					label: path,
				}));

				const selectedSymlinks = await p.multiselect({
					message: `Found ${candidates.length} symlink candidate(s) in your project. Select which to symlink:`,
					options,
					required: false,
				});

				if (p.isCancel(selectedSymlinks)) {
					p.cancel("Initialization cancelled.");
					return 0;
				}

				symlinkFiles = selectedSymlinks as string[];

				// Ask if they want to add custom files
				const addCustom = await p.confirm({
					message: "Add additional custom files/directories to symlink?",
					initialValue: false,
				});

				if (p.isCancel(addCustom)) {
					p.cancel("Initialization cancelled.");
					return 0;
				}

				if (addCustom) {
					const customFiles = await p.text({
						message: "Enter custom files/directories (comma-separated)",
						placeholder: "vendor, .cache, custom-dir",
					});

					if (p.isCancel(customFiles)) {
						p.cancel("Initialization cancelled.");
						return 0;
					}

					if (customFiles && customFiles.trim() !== "") {
						const customList = customFiles
							.split(",")
							.map((f) => f.trim())
							.filter((f) => f !== "");
						symlinkFiles = [...symlinkFiles, ...customList];
					}
				}
			}
		}

		// Ask whether to delete remote branches after merging
		const deleteRemoteOnFinish = await p.confirm({
			message: "Delete remote branches after merging?",
			initialValue: false,
		});

		if (p.isCancel(deleteRemoteOnFinish)) {
			p.cancel("Initialization cancelled.");
			return 0;
		}

		// Build config object
		const config: Config = {
			base_branch: baseBranch || "main",
			worktrees_dir: worktreesDir || "../worktrees",
			ai_model: aiModel || "google/gemini-3-flash-preview",
			open_terminal: openTerminal ?? true,
			delete_remote_on_finish: deleteRemoteOnFinish ?? false,
			ide: ideName,
			symlink_files: symlinkFiles,
		};

		// Write config to file
		try {
			const yamlContent = stringify(config, {
				indent: 2,
				lineWidth: 0,
			});

			writeFileSync(configPath, yamlContent, "utf-8");

			// Print summary
			p.outro("✅ Configuration saved successfully!");

			stdout("\n📋 Configuration Summary:");
			stdout(`   Base branch: ${config.base_branch}`);
			stdout(`   Worktrees directory: ${config.worktrees_dir}`);
			stdout(`   AI model: ${config.ai_model}`);
			stdout(`   Auto-open terminal: ${config.open_terminal ? "Yes" : "No"}`);
			stdout(`   IDE: ${config.ide || "None"}`);
			stdout(
				`   Symlink files: ${config.symlink_files.length > 0 ? config.symlink_files.join(", ") : "None"}`,
			);
			stdout(`   Delete remote on finish: ${config.delete_remote_on_finish}`);
			stdout(`\n📁 Config file: ${configPath}`);

			// Ask about shell alias
			const createAlias = await p.confirm({
				message: "Create shell alias (e.g., 'gf' for 'gitterflow')?",
				initialValue: true,
			});

			if (!p.isCancel(createAlias) && createAlias) {
				const aliasName = await p.text({
					message: "Alias name?",
					initialValue: "gf",
					placeholder: "gf",
				});

				if (!p.isCancel(aliasName) && aliasName) {
					const shellConfig = detectShell();

					if (shellConfig.type === "unknown") {
						stdout(
							`⚠️  Could not detect shell (SHELL=${process.env.SHELL || "unknown"}). Skipping alias creation.`,
						);
					} else {
						stdout(`\n🔧 Detected shell: ${shellConfig.type}`);
						stdout(`   Config file: ${shellConfig.configFile}`);

						await addShellAlias(
							aliasName.trim() || "gf",
							"gitterflow",
							shellConfig,
							stdout,
							stderr,
						);
					}
				}
			}

			return 0;
		} catch (error) {
			p.cancel("Failed to write configuration file.");
			stderr(
				`❌ Error: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	},
};
