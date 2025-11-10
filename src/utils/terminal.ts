import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { getSetting } from "../config";

/**
 * Spawn a new terminal window/tab in the specified directory and run the coding agent
 * Supports configurable terminal types and coding agent commands
 */
export function spawnTerminal(dir: string, agentCommand?: string): void {
	const os = platform();
	const absolutePath = resolve(dir);
	const terminal = getSetting("terminal");
	const codingAgent = agentCommand ?? getSetting("coding_agent");

	if (os === "darwin") {
		if (terminal === "iterm") {
			// iTerm2 - create new tab, cd to directory, and run agent command
			spawn("osascript", [
				"-e",
				'tell application "iTerm"',
				"-e",
				"tell current window",
				"-e",
				"create tab with default profile",
				"-e",
				"tell current session of current tab",
				"-e",
				`write text "cd '${absolutePath}' && ${codingAgent}"`,
				"-e",
				"end tell",
				"-e",
				"end tell",
				"-e",
				"end tell",
			]);
		} else {
			// Terminal.app (default) - cd to directory and run agent command
			const script = `tell application "Terminal"
         do script "cd '${absolutePath}' && ${codingAgent}"
         activate
       end tell`;
			spawn("osascript", ["-e", script]);
		}
	} else if (os === "linux") {
		if (terminal === "gnome-terminal") {
			// GNOME Terminal - cd and run agent command
			spawn(
				"gnome-terminal",
				[
					"--working-directory",
					absolutePath,
					"--",
					"bash",
					"-c",
					`cd '${absolutePath}' && ${codingAgent}; exec bash`,
				],
				{ detached: true },
			);
		} else {
			// Fallback to gnome-terminal
			spawn(
				"gnome-terminal",
				[
					"--working-directory",
					absolutePath,
					"--",
					"bash",
					"-c",
					`cd '${absolutePath}' && ${codingAgent}; exec bash`,
				],
				{ detached: true },
			);
		}
	} else if (os === "win32") {
		if (terminal === "windows-terminal") {
			// Windows Terminal - cd and run agent command
			spawn(
				"wt.exe",
				[
					"-w",
					"0",
					"powershell.exe",
					"-NoExit",
					`cd '${absolutePath}'; ${codingAgent}`,
				],
				{ detached: true },
			);
		} else {
			// Fallback to cmd - cd and run agent command
			spawn("cmd.exe", ["/k", `cd /d ${absolutePath} && ${codingAgent}`], {
				detached: true,
			});
		}
	} else {
		throw new Error(`Unsupported OS: ${os}`);
	}
}
