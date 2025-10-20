import { describe, expect, test } from "bun:test";
import { captureExec, commandIO } from "../utils";
import { listCommand } from "../../src/commands/list";

describe("start command", () => {
	describe("argument validation", () => {
		test("should invoke git worktree list", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			const exitCode = await listCommand.run({
				args: [],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.strings.join("")).toEqual("git worktree list");
			expect(calls[0]?.values).toEqual([]);
		});
		test("should work when arguments are provided", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();

			const exitCode = await listCommand.run({
				args: ["feature/new-feature"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.strings.join("")).toEqual("git worktree list");
		});
	});
});
