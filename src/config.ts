import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

export interface GitterflowConfig {
	base_branch: string;
	worktrees_dir: string;
	ai_model: string;
	open_terminal: boolean;
	delete_remote_on_finish: boolean;
	coding_agent: string;
	terminal: string;
	ide: string | null;
	symlink_files: string[];
}

let cachedConfig: GitterflowConfig | null = null;

export function loadConfig(): GitterflowConfig {
	if (cachedConfig) return cachedConfig;

	const configPath = resolve(".gitterflow.yaml");
	if (!existsSync(configPath)) {
		// return defaults if no config exists
		cachedConfig = {
			base_branch: "main",
			worktrees_dir: "../worktrees",
			ai_model: "qwen/qwen3-235b-a22b-2507",
			open_terminal: true,
			delete_remote_on_finish: false,
			coding_agent: "claude",
			terminal: "iterm",
			ide: null,
			symlink_files: [],
		};
		return cachedConfig;
	}

	const raw = readFileSync(configPath, "utf8");
	const parsed = YAML.parse(raw) ?? {};

	// Merge with defaults to ensure all keys exist
	cachedConfig = {
		base_branch: parsed.base_branch ?? "main",
		worktrees_dir: parsed.worktrees_dir ?? "../worktrees",
		ai_model: parsed.ai_model ?? "qwen/qwen3-235b-a22b-2507",
		open_terminal: parsed.open_terminal ?? true,
		delete_remote_on_finish: parsed.delete_remote_on_finish ?? false,
		coding_agent: parsed.coding_agent ?? "claude",
		terminal: parsed.terminal ?? "iterm",
		ide: parsed.ide ?? null,
		symlink_files: parsed.symlink_files ?? [],
	};

	return cachedConfig;
}

export function getSetting<K extends keyof GitterflowConfig>(
	key: K,
): GitterflowConfig[K] {
	const cfg = loadConfig();
	return cfg[key];
}
