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

		// Return mock result that supports .text() for git diff commands
		const command = strings.join("");
		if (command.includes("git diff --cached")) {
			// Create a mock object that supports .text() method chaining
			// Bun's $ API: run`command`.text() - the template literal returns an object with .text()
			const mockResult: { text: () => Promise<string> } = {
				text: async () => "diff --git a/test.txt b/test.txt\n+new content",
			};
			// Return as both a promise and an object with .text() method
			return Object.assign(
				Promise.resolve(mockResult),
				mockResult,
			) as unknown as Promise<{ text: () => Promise<string> }> & {
				text: () => Promise<string>;
			};
		}
		return Promise.resolve({});
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
