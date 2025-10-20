import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli";
import { HELP_MESSAGE } from "../src/commands/help";
import { listCommand } from "../src/commands/list";
import { captureExec, createIO } from "./utils";

describe("GitterFlow CLI", () => {
	test("prints help information for --help", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli(["--help"], io);

		expect(exitCode).toBe(0);
		expect(stderr).toHaveLength(0);
		expect(stdout[0]).toBe(HELP_MESSAGE);
		expect(stdout[2]).toContain("gitterflow start <branch>");
	});

	test("returns error code for unknown command and shows help", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli(["unknown"], io);

		expect(exitCode).toBe(1);
		expect(stderr[0]).toContain("Unknown command");
		expect(stdout[0]).toBe(HELP_MESSAGE);
	});

	test("defaults to help when no arguments are provided", async () => {
		const { stdout, stderr, io } = createIO();

		const exitCode = await runCli([], io);

		expect(exitCode).toBe(0);
		expect(stderr).toHaveLength(0);
		expect(stdout[0]).toBe(HELP_MESSAGE);
	});
});

describe("Command implementations", () => {
	test("list command invokes git worktree list", async () => {
		const { exec, calls } = captureExec();

		const exitCode = await listCommand.run({
			args: [],
			exec,
			stdout: () => {},
			stderr: () => {},
		});

		expect(exitCode).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].strings).toEqual(["git worktree list"]);
		expect(calls[0].values).toEqual([]);
	});
});
