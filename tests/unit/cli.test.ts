import { afterEach, describe, expect, test } from "bun:test";
import { runCli } from "../../src/cli";
import { commandMap } from "../../src/commands";
import { HELP_MESSAGE } from "../../src/commands/help";
import type { CommandDefinition } from "../../src/commands/types";
import { createIO } from "./test-helpers";

const restoreMapEntry = (
	key: string,
	original: CommandDefinition | undefined,
) => {
	if (original) {
		commandMap[key] = original;
	} else {
		delete commandMap[key];
	}
};

describe("GitterFlow CLI", () => {
	const tempCommandKey = "__test__";
	let originalCommand: CommandDefinition | undefined;

	afterEach(() => {
		restoreMapEntry(tempCommandKey, originalCommand);
		originalCommand = undefined;
	});

	test("prints help information for --help", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli(["--help"], io);

		expect(exitCode).toBe(0);
		expect(stderr).toHaveLength(0);
		expect(stdout[0]).toBe(HELP_MESSAGE);
		expect(stdout[1]).toContain("Available Commands");
		expect(stdout[2]).toContain("gitterflow new [branch]");
	});

	test("prints help information for help aliases", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli(["-h"], io);

		expect(exitCode).toBe(0);
		expect(stderr).toHaveLength(0);
		expect(stdout[0]).toBe(HELP_MESSAGE);
	});

	test("returns error code for unknown command and shows help footer", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli(["unknown"], io);

		expect(exitCode).toBe(1);
		expect(stderr[0]).toContain("Unknown command");
		expect(stdout[0]).toBe(HELP_MESSAGE);
		expect(stdout[1]).toContain("Available Commands");
	});

	test("defaults to help when no arguments are provided", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli([], io);

		expect(exitCode).toBe(0);
		expect(stderr).toHaveLength(0);
		expect(stdout[0]).toBe(HELP_MESSAGE);
	});

	test("invokes matching command with arguments and shared executor", async () => {
		const { stdout, stderr, io } = createIO();
		const received: { args?: string[]; execType?: string } = {};

		originalCommand = commandMap[tempCommandKey];
		commandMap[tempCommandKey] = {
			name: tempCommandKey,
			description: "Test command",
			run: ({ args, exec, stdout: invokeStdout }) => {
				received.args = args;
				received.execType = typeof exec;
				invokeStdout("stub command executed");
				return 7;
			},
		};

		const exitCode = await runCli([tempCommandKey, "alpha", "beta"], io);

		expect(exitCode).toBe(7);
		expect(stderr).toHaveLength(0);
		expect(received.args).toEqual(["alpha", "beta"]);
		expect(received.execType).toBe("function");
		expect(stdout[0]).toBe("stub command executed");
	});

	test("uses default IO when none is provided", async () => {
		const logs: string[] = [];
		const errors: string[] = [];
		const originalLog = console.log;
		const originalError = console.error;

		console.log = (message?: unknown) => {
			logs.push(String(message));
		};
		console.error = (message?: unknown) => {
			errors.push(String(message));
		};

		try {
			const exitCode = await runCli([]);

			expect(exitCode).toBe(0);
			expect(errors).toHaveLength(0);
			expect(logs[0]).toBe(HELP_MESSAGE);
			expect(logs[1]).toContain("Available Commands");
		} finally {
			console.log = originalLog;
			console.error = originalError;
		}
	});

	test("restores original command map after custom execution", async () => {
		originalCommand = commandMap[tempCommandKey];
		commandMap[tempCommandKey] = {
			name: tempCommandKey,
			description: "Temporary command",
			run: ({ stdout: invokeStdout }) => {
				invokeStdout("temporary command");
				return 0;
			},
		};

		await runCli([tempCommandKey]);
		restoreMapEntry(tempCommandKey, originalCommand);

		expect(commandMap[tempCommandKey]).toBe(originalCommand);
	});
});
