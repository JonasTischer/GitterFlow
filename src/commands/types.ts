export type CommandIO = {
	stdout: (message: string) => void;
	stderr: (message: string) => void;
};

export type CommandExecutor = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => Promise<unknown>;

export type CommandContext = CommandIO & {
	args: string[];
	exec?: CommandExecutor;
};

export type CommandHandler = (
	context: CommandContext,
) => Promise<number> | number;

export type CommandDefinition = {
	name: string;
	description: string;
	usage?: string;
	aliases?: string[];
	run: CommandHandler;
};
