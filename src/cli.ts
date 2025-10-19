import { $ } from "bun";
import { commandMap, orderedCommands } from "./commands";
import { helpCommand, HELP_MESSAGE } from "./commands/help";
import type { CommandIO } from "./commands/types";

const defaultIO: CommandIO = {
  stdout: (message: string) => console.log(message),
  stderr: (message: string) => console.error(message),
};

const printHelpFooter = (stdout: CommandIO["stdout"]) => {
  const commandSummaries = orderedCommands
    .map((command) => {
      const usage = command.usage ? `  ${command.usage}` : `  gitterflow ${command.name}`;
      return `${usage.padEnd(30)} ${command.description}`;
    })
    .join("\n");

  stdout("\nAvailable Commands:\n");
  stdout(commandSummaries);
};

const runHelpWithMetadata = (io: CommandIO) => {
  helpCommand.run({ args: [], ...io });
  printHelpFooter(io.stdout);
  return 0;
};

export async function runCli(rawArgs: string[], io: CommandIO = defaultIO): Promise<number> {
  const [maybeCommand, ...commandArgs] = rawArgs;
  const commandKey = maybeCommand ?? "help";
  const command = commandMap[commandKey];

  if (!command) {
    io.stderr(`Unknown command or option: ${commandKey}`);
    runHelpWithMetadata(io);
    return 1;
  }

  if (command === helpCommand) {
    return runHelpWithMetadata(io);
  }

  return await command.run({ args: commandArgs, exec: $, ...io });
}
