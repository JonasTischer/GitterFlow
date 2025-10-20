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

export { createIO, noExec, captureExec, commandIO };
