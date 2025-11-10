import { spawn } from "node:child_process";
import { platform } from "node:os";
import { resolve } from "node:path";
import { getSetting } from "../config";

/**
 * Open an IDE in the specified directory
 * Supports Cursor, VS Code, and other IDEs
 */
export function openIDE(dir: string, agentCommand?: string): void {
	const os = platform();
	const absolutePath = resolve(dir);
	const ide = getSetting("ide");
	const codingAgent = agentCommand ?? getSetting("coding_agent");

	if (!ide) {
		throw new Error("No IDE configured");
	}

	const ideLower = ide.toLowerCase();

	if (os === "darwin") {
		if (ideLower === "cursor") {
			// Try to use cursor CLI first (more reliable)
			try {
				// Open Cursor with the directory
				spawn("cursor", [absolutePath], { detached: true });

				// Wait for Cursor to open, then create terminal and run command
				setTimeout(() => {
					// Improved AppleScript that targets the Cursor process specifically
					// Escape single quotes in path
					const escapedPath = absolutePath.replace(/'/g, "\\'");
					const script = `tell application "Cursor"
	activate
end tell
delay 1
tell application "System Events"
	tell process "Cursor"
		-- Toggle terminal panel with Cmd+J
		keystroke "j" using command down
		delay 0.8
		-- Create new terminal with Ctrl+Shift+\`
		keystroke "\`" using {control down, shift down}
		delay 0.5
		-- Type the command
		keystroke "cd '${escapedPath}' && ${codingAgent}"
		keystroke return
	end tell
end tell`;

					spawn("osascript", ["-e", script]);
				}, 2000);
			} catch {
				// Fallback to open command
				spawn("open", ["-a", "Cursor", absolutePath]);

				setTimeout(() => {
					// Escape single quotes in path
					const escapedPath = absolutePath.replace(/'/g, "\\'");
					const script = `tell application "Cursor"
	activate
end tell
delay 1
tell application "System Events"
	tell process "Cursor"
		-- Toggle terminal panel with Cmd+J
		keystroke "j" using command down
		delay 4
		-- Create new terminal with Ctrl+Shift+\`
		keystroke "\`" using {control down, shift down}
		delay 5
		-- Type the command
		keystroke "cd '${escapedPath}' && ${codingAgent}"
		keystroke return
	end tell
end tell`;

					spawn("osascript", ["-e", script]);
				}, 2000);
			}
		} else if (ideLower === "code" || ideLower === "vscode") {
			// Open VS Code
			spawn("open", ["-a", "Visual Studio Code", absolutePath]);

			// Create terminal in VS Code
			setTimeout(() => {
				spawn("osascript", [
					"-e",
					'tell application "Visual Studio Code"',
					"-e",
					"activate",
					"-e",
					'tell application "System Events"',
					"-e",
					'keystroke "`" using {control down, shift down}', // Cmd+Shift+` to create new terminal
					"-e",
					"end tell",
					"-e",
					"end tell",
				]);

				setTimeout(() => {
					spawn("osascript", [
						"-e",
						'tell application "Visual Studio Code"',
						"-e",
						'tell application "System Events"',
						"-e",
						`keystroke "cd '${absolutePath}' && ${codingAgent}\\n"`,
						"-e",
						"end tell",
						"-e",
						"end tell",
					]);
				}, 1000);
			}, 2000);
		} else {
			// Generic IDE - try to open with the name provided
			spawn("open", ["-a", ide, absolutePath]);
		}
	} else if (os === "linux") {
		if (ideLower === "cursor") {
			spawn("cursor", [absolutePath], { detached: true });
		} else if (ideLower === "code" || ideLower === "vscode") {
			spawn("code", [absolutePath], { detached: true });
		} else {
			// Try to run the IDE command directly
			spawn(ide, [absolutePath], { detached: true });
		}
	} else if (os === "win32") {
		if (ideLower === "cursor") {
			spawn("cursor", [absolutePath], { detached: true, shell: true });
		} else if (ideLower === "code" || ideLower === "vscode") {
			spawn("code", [absolutePath], { detached: true, shell: true });
		} else {
			spawn(ide, [absolutePath], { detached: true, shell: true });
		}
	} else {
		throw new Error(`Unsupported OS: ${os}`);
	}
}
