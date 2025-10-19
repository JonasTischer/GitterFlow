import { describe, expect, test } from "bun:test";
import { HELP_MESSAGE } from "../src/commands/help";
import { deleteCommand } from "../src/commands/delete";
import { listCommand } from "../src/commands/list";
import { startCommand } from "../src/commands/start";
import { runCli } from "../src/cli";

const createIO = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      stdout: (message: string) => {
        stdout.push(message);
      },
      stderr: (message: string) => {
        stderr.push(message);
      },
    },
  };
};

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
  const noExec = async () => {
    throw new Error("exec should not be invoked in this scenario");
  };

  const captureExec = () => {
    const calls: Array<{ strings: string[]; values: unknown[] }> = [];

    const exec = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({
        strings: Array.from(strings),
        values,
      });
    };

    return { exec, calls };
  };

  const commandIO = () => {
    const stdoutMessages: string[] = [];
    const stderrMessages: string[] = [];

    const io = {
      stdout: (message: string) => stdoutMessages.push(message),
      stderr: (message: string) => stderrMessages.push(message),
    };

    return { stdoutMessages, stderrMessages, io };
  };

  test("start command validates required branch argument", async () => {
    const { io, stderrMessages } = commandIO();

    const exitCode = await startCommand.run({ args: [], exec: noExec, ...io });

    expect(exitCode).toBe(1);
    expect(stderrMessages[0]).toContain("Please provide a branch name");
  });

  test("start command invokes git worktree add", async () => {
    const { exec, calls } = captureExec();
    const { io, stdoutMessages, stderrMessages } = commandIO();

    const exitCode = await startCommand.run({
      args: ["feature/new-feature"],
      exec,
      ...io,
    });

    expect(exitCode).toBe(0);
    expect(stderrMessages).toHaveLength(0);
    expect(stdoutMessages[0]).toContain("Created worktree for branch feature/new-feature");
    expect(calls).toHaveLength(1);
    expect(calls[0].strings).toEqual(["git worktree add ../", " ", ""]);
    expect(calls[0].values).toEqual(["feature/new-feature", "feature/new-feature"]);
  });

  test("delete command validates required branch argument", async () => {
    const { io, stderrMessages } = commandIO();

    const exitCode = await deleteCommand.run({ args: [], exec: noExec, ...io });

    expect(exitCode).toBe(1);
    expect(stderrMessages[0]).toContain("Please provide a branch name to delete");
  });

  test("delete command invokes git worktree remove", async () => {
    const { exec, calls } = captureExec();
    const { io, stdoutMessages, stderrMessages } = commandIO();

    const exitCode = await deleteCommand.run({
      args: ["feature/new-feature"],
      exec,
      ...io,
    });

    expect(exitCode).toBe(0);
    expect(stderrMessages).toHaveLength(0);
    expect(stdoutMessages[0]).toContain("Removed worktree for branch feature/new-feature");
    expect(calls).toHaveLength(1);
    expect(calls[0].strings).toEqual(["git worktree remove ../", ""]);
    expect(calls[0].values).toEqual(["feature/new-feature"]);
  });

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
