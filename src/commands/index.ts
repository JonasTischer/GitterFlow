import { deleteCommand } from "./delete";
import { helpCommand } from "./help";
import { initCommand } from "./init";
import { listCommand } from "./list";
import { newCommand } from "./new";
import { snapCommand } from "./snap";
import type { CommandDefinition } from "./types";

export const commandMap: Record<string, CommandDefinition> = {
	help: helpCommand,
	init: initCommand,
	new: newCommand,
	list: listCommand,
	delete: deleteCommand,
	snap: snapCommand,
};

for (const definition of Object.values(commandMap)) {
	if (!definition.aliases) continue;
	for (const alias of definition.aliases) {
		commandMap[alias] = definition;
	}
}

export const orderedCommands: CommandDefinition[] = [
	initCommand,
	newCommand,
	listCommand,
	deleteCommand,
	snapCommand,
	helpCommand,
];
