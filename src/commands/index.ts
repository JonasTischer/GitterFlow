import { deleteCommand } from "./delete";
import { helpCommand } from "./help";
import { listCommand } from "./list";
import { newCommand } from "./new";
import type { CommandDefinition } from "./types";

export const commandMap: Record<string, CommandDefinition> = {
	help: helpCommand,
	new: newCommand,
	list: listCommand,
	delete: deleteCommand,
};

for (const definition of Object.values(commandMap)) {
	if (!definition.aliases) continue;
	for (const alias of definition.aliases) {
		commandMap[alias] = definition;
	}
}

export const orderedCommands: CommandDefinition[] = [
	newCommand,
	listCommand,
	deleteCommand,
	helpCommand,
];
