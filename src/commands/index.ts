import { approveCommand } from "./approve";
import { deleteCommand } from "./delete";
import { finishCommand } from "./finish";
import { helpCommand } from "./help";
import { initCommand } from "./init";
import { listCommand } from "./list";
import { markFailedCommand } from "./mark-failed";
import { newCommand } from "./new";
import { readyCommand } from "./ready";
import { rejectCommand } from "./reject";
import { snapCommand } from "./snap";
import { startedCommand } from "./started";
import { statusCommand } from "./status";
import type { CommandDefinition } from "./types";

export const commandMap: Record<string, CommandDefinition> = {
	help: helpCommand,
	init: initCommand,
	new: newCommand,
	list: listCommand,
	delete: deleteCommand,
	snap: snapCommand,
	finish: finishCommand,
	ready: readyCommand,
	started: startedCommand,
	status: statusCommand,
	"mark-failed": markFailedCommand,
	approve: approveCommand,
	reject: rejectCommand,
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
	statusCommand,
	approveCommand,
	rejectCommand,
	deleteCommand,
	snapCommand,
	readyCommand,
	finishCommand,
	markFailedCommand,
	helpCommand,
];
