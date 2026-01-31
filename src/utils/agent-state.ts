import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import * as yaml from "yaml";

/**
 * Valid status values for an agent task
 *
 * Status transitions:
 *   pending → running → ready → merged
 *                         ↓
 *                      conflict → [brain resolves] → merged
 *                         ↓
 *                       failed
 *
 * Note: 'completed' is deprecated for autonomous agents.
 * Use 'ready' (work done, awaiting brain merge) or 'merged' (brain completed merge).
 */
export type AgentStatus =
	| "pending"
	| "awaiting_approval" // Plan written, waiting for brain to review
	| "running"
	| "ready"
	| "completed"
	| "failed"
	| "conflict"
	| "merged";

/**
 * Represents the state of an agent working on a task
 */
export interface AgentState {
	/** The git branch name for this task */
	branch: string;
	/** Description of the task being worked on */
	task: string;
	/** Current status of the agent */
	status: AgentStatus;
	/** ISO timestamp when the task was started (updated when agent actually starts) */
	started_at: string;
	/** ISO timestamp when the terminal was spawned (for pending status display) */
	spawned_at?: string;
	/** ISO timestamp when the task completed (for terminal states) */
	completed_at?: string;
	/** Absolute path to the worktree directory */
	worktree_path: string;
	/** The base branch this was forked from */
	base_branch: string;
	/** Error message if the task failed */
	error?: string;
	/** Status message from agent (set via gf status --write) */
	message?: string;
	/** Path to the plan file (for awaiting_approval status) */
	plan_file?: string;
	/** Parent branch name (for recursive sub-agent tracking) */
	parent_branch?: string;
	/** Nesting depth (0 = brain, 1 = direct sub-agent, 2+ = recursive) */
	depth?: number;
	/** Process ID if spawned in background */
	pid?: number;
}

/**
 * Options for filtering agent states
 */
export interface ListAgentStatesOptions {
	/** Filter by status */
	status?: AgentStatus;
}

/**
 * Options for updating agent status
 */
export interface UpdateStatusOptions {
	/** Error message to include (typically for failed status) */
	error?: string;
}

/**
 * Sanitize a branch name for use as a filename
 * Replaces slashes with dashes to avoid directory creation issues
 */
function sanitizeBranchName(branch: string): string {
	return branch.replace(/\//g, "-");
}

/**
 * Get the path to the agents state directory
 */
function getAgentsDir(rootDir: string): string {
	return join(rootDir, ".gitterflow", "agents");
}

/**
 * Get the path to a specific agent state file
 */
function getAgentStatePath(branch: string, rootDir: string): string {
	return join(getAgentsDir(rootDir), `${sanitizeBranchName(branch)}.yaml`);
}

/**
 * Ensure the agents directory exists
 */
async function ensureAgentsDir(rootDir: string): Promise<void> {
	const agentsDir = getAgentsDir(rootDir);
	await mkdir(agentsDir, { recursive: true });
}

/**
 * Write an agent state to a YAML file
 *
 * Creates or overwrites the state file at .gitterflow/agents/BRANCH.yaml
 * The branch name has slashes replaced with dashes in the filename.
 *
 * @param state - The agent state to write
 * @param rootDir - Root directory of the repository (defaults to cwd)
 */
export async function writeAgentState(
	state: AgentState,
	rootDir: string = process.cwd(),
): Promise<void> {
	await ensureAgentsDir(rootDir);

	const filePath = getAgentStatePath(state.branch, rootDir);
	const content = yaml.stringify(state);

	await Bun.write(filePath, content);
}

/**
 * Read an agent state from a YAML file
 *
 * @param branch - The branch name to look up
 * @param rootDir - Root directory of the repository (defaults to cwd)
 * @returns The agent state, or null if not found
 */
export async function readAgentState(
	branch: string,
	rootDir: string = process.cwd(),
): Promise<AgentState | null> {
	const filePath = getAgentStatePath(branch, rootDir);
	const file = Bun.file(filePath);

	if (!(await file.exists())) {
		return null;
	}

	const content = await file.text();
	return yaml.parse(content) as AgentState;
}

/**
 * List all agent states
 *
 * @param rootDir - Root directory of the repository (defaults to cwd)
 * @param options - Optional filters for the list
 * @returns Array of agent states
 */
export async function listAgentStates(
	rootDir: string = process.cwd(),
	options?: ListAgentStatesOptions,
): Promise<AgentState[]> {
	const agentsDir = getAgentsDir(rootDir);

	try {
		// readdir will throw if directory doesn't exist
		const files = await readdir(agentsDir);
		const yamlFiles = files.filter((f) => f.endsWith(".yaml"));

		const states: AgentState[] = [];

		for (const file of yamlFiles) {
			const filePath = join(agentsDir, file);
			const content = await Bun.file(filePath).text();
			const state = yaml.parse(content) as AgentState;

			// Apply status filter if provided
			if (options?.status && state.status !== options.status) {
				continue;
			}

			states.push(state);
		}

		return states;
	} catch {
		// Directory doesn't exist, return empty array
		return [];
	}
}

/**
 * Update the status of an existing agent
 *
 * Automatically sets completed_at for terminal statuses (completed, failed, merged).
 *
 * @param branch - The branch name to update
 * @param status - The new status
 * @param rootDir - Root directory of the repository (defaults to cwd)
 * @param options - Optional additional updates (e.g., error message)
 * @throws Error if the agent state does not exist
 */
export async function updateAgentStatus(
	branch: string,
	status: AgentStatus,
	rootDir: string = process.cwd(),
	options?: UpdateStatusOptions,
): Promise<void> {
	const state = await readAgentState(branch, rootDir);

	if (!state) {
		throw new Error(`Agent state not found for branch: ${branch}`);
	}

	// Update status
	state.status = status;

	// Set completed_at for terminal statuses
	const terminalStatuses: AgentStatus[] = ["completed", "failed", "merged"];
	if (terminalStatuses.includes(status)) {
		state.completed_at = new Date().toISOString();
	}

	// Add error message if provided
	if (options?.error) {
		state.error = options.error;
	}

	await writeAgentState(state, rootDir);
}
