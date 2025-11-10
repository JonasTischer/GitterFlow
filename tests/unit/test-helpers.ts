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

		// Return mock result that supports .text() for various git commands
		const command = strings.join("");

		if (command.includes("git diff --cached")) {
			const mockResult: { text: () => Promise<string> } = {
				text: async () => "diff --git a/test.txt b/test.txt\n+new content",
			};
			return Object.assign(
				Promise.resolve(mockResult),
				mockResult,
			) as unknown as Promise<{ text: () => Promise<string> }> & {
				text: () => Promise<string>;
			};
		}

		if (command.includes("git rev-parse --abbrev-ref HEAD")) {
			const mockResult: { text: () => Promise<string> } = {
				text: async () => "main",
			};
			return Object.assign(
				Promise.resolve(mockResult),
				mockResult,
			) as unknown as Promise<{ text: () => Promise<string> }> & {
				text: () => Promise<string>;
			};
		}

		if (command.includes("git rev-parse --show-toplevel")) {
			const mockResult: { text: () => Promise<string> } = {
				text: async () => "/test/repo",
			};
			return Object.assign(
				Promise.resolve(mockResult),
				mockResult,
			) as unknown as Promise<{ text: () => Promise<string> }> & {
				text: () => Promise<string>;
			};
		}

		if (command.includes("git worktree list")) {
			const mockResult: { text: () => Promise<string> } = {
				text: async () => "",
			};
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
