import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { snapCommand } from "../../../src/commands/snap";
import { captureExec, commandIO } from "../test-helpers";

// Mock fetch globally
const originalFetch = global.fetch;
let fetchCalls: Array<{
	url: string;
	options: RequestInit;
}> = [];

beforeEach(() => {
	fetchCalls = [];
	global.fetch = (async (url: string | URL, options?: RequestInit) => {
		fetchCalls.push({
			url: String(url),
			options: options || {},
		});

		// Return mock response
		return new Response(
			JSON.stringify({
				choices: [
					{
						message: {
							content: "feat: add new feature",
						},
					},
				],
			}),
			{
				status: 200,
				headers: { "Content-Type": "application/json" },
			},
		);
	}) as typeof fetch;
});

afterEach(() => {
	global.fetch = originalFetch;
	delete process.env.OPENROUTER_API_KEY;
	delete process.env.GITTERFLOW_MODEL;
	delete process.env.GF_MODEL;
	delete process.env.GITTERFLOW_OPENROUTER_MODEL;
	delete process.env.GF_OPENROUTER_MODEL;
});

describe("snap command", () => {
	describe("git operations", () => {
		test("should stage all files with git add -A", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			// Should call git add -A
			expect(
				calls.some((call) => call.strings.join("").includes("git add -A")),
			).toBe(true);
		});

		test("should get diff with git diff --cached", async () => {
			const { exec, calls } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			// Should call git diff --cached
			expect(
				calls.some((call) =>
					call.strings.join("").includes("git diff --cached"),
				),
			).toBe(true);
		});

		test("should commit with generated message", async () => {
			const { exec, calls } = captureExec();
			const { io, stdoutMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			// Should call git commit -m with the generated message
			const commitCall = calls.find((call) =>
				call.strings.join("").includes("git commit -m"),
			);
			expect(commitCall).toBeDefined();
			expect(
				stdoutMessages.some((msg) => msg.includes("✅ Commit created:")),
			).toBe(true);
		});
	});

	describe("no changes handling", () => {
		test("should output message when no changes to commit", async () => {
			const { calls } = captureExec();
			const { io, stdoutMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			// Mock git diff to return empty
			const mockExec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				if (strings.join("").includes("git diff --cached")) {
					const mockResult = {
						text: async () => "",
					};
					return Object.assign(
						Promise.resolve(mockResult),
						mockResult,
					) as unknown as Promise<{ text: () => Promise<string> }> & {
						text: () => Promise<string>;
					};
				}
				if (strings.join("").includes("git add -A")) {
					return Promise.resolve({});
				}
				return Promise.resolve({});
			};

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"], // Add --no-confirm to avoid waiting for input
				exec: mockExec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(
				stdoutMessages.some((msg) => msg.includes("No changes to commit")),
			).toBe(true);
		});
	});

	describe("OpenRouter API integration", () => {
		test("should call OpenRouter API with correct parameters", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-api-key";

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(fetchCalls).toHaveLength(1);
			expect(fetchCalls[0]?.url).toBe(
				"https://openrouter.ai/api/v1/chat/completions",
			);
			expect(fetchCalls[0]?.options.method).toBe("POST");
			expect(
				(fetchCalls[0]?.options.headers as Record<string, string>)?.[
					"Content-Type"
				],
			).toBe("application/json");
			expect(
				(fetchCalls[0]?.options.headers as Record<string, string>)
					?.Authorization,
			).toBe("Bearer test-api-key");
		});

		test("should use default model (anthropic/claude-3.5-sonnet)", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";
			// Ensure no model env var is set
			delete process.env.GITTERFLOW_MODEL;
			delete process.env.GF_MODEL;
			delete process.env.GITTERFLOW_OPENROUTER_MODEL;
			delete process.env.GF_OPENROUTER_MODEL;

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(fetchCalls.length).toBeGreaterThan(0);
			const body = JSON.parse(fetchCalls[0]?.options.body as string) as {
				model?: string;
			};
			expect(body.model).toBe("qwen/qwen3-235b-a22b-2507");
		});

		test("should use configured model from environment variable", async () => {
			const { exec } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";
			process.env.GITTERFLOW_MODEL = "qwen/qwen3-235b-a22b-2507";

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(fetchCalls.length).toBeGreaterThan(0);
			const body = JSON.parse(fetchCalls[0]?.options.body as string) as {
				model?: string;
				provider?: { sort?: string };
			};
			expect(body.model).toBe("qwen/qwen3-235b-a22b-2507");
			// Qwen models should have provider config
			expect(body.provider?.sort).toBe("throughput");
		});

		test("should include diff in the prompt", async () => {
			const { calls } = captureExec();
			const { io } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			// Mock git diff to return a test diff
			const testDiff = "diff --git a/file.txt b/file.txt\n+new line";
			const mockExec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				if (strings.join("").includes("git diff --cached")) {
					const mockResult = {
						text: async () => testDiff,
					};
					return Object.assign(
						Promise.resolve(mockResult),
						mockResult,
					) as unknown as Promise<{ text: () => Promise<string> }> & {
						text: () => Promise<string>;
					};
				}
				if (strings.join("").includes("git add -A")) {
					return Promise.resolve({});
				}
				if (strings.join("").includes("git commit -m")) {
					return Promise.resolve({});
				}
				return Promise.resolve({});
			};

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec: mockExec,
				...io,
			});

			expect(exitCode).toBe(0);
			expect(fetchCalls.length).toBeGreaterThan(0);
			const body = JSON.parse(fetchCalls[0]?.options.body as string) as {
				messages?: Array<{ content?: string }>;
			};
			expect(body.messages?.[0]?.content).toContain(testDiff);
		});

		test("should error when OPENROUTER_API_KEY is not set", async () => {
			const { exec } = captureExec();
			const { io, stderrMessages } = commandIO();
			delete process.env.OPENROUTER_API_KEY;

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(
				stderrMessages.some((msg) => msg.includes("OPENROUTER_API_KEY")),
			).toBe(true);
		});

		test("should handle API errors gracefully", async () => {
			const { calls } = captureExec();
			const { io, stderrMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			// Mock fetch to return error
			global.fetch = (async () => {
				return new Response("API Error", { status: 500 });
			}) as unknown as typeof fetch;

			const mockExec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				if (strings.join("").includes("git diff --cached")) {
					return {
						text: async () => "some diff",
					} as unknown as Promise<unknown> & { text: () => Promise<string> };
				}
				if (strings.join("").includes("git add -A")) {
					return Promise.resolve({});
				}
				return Promise.resolve({});
			};

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec: mockExec,
				...io,
			});

			expect(exitCode).toBe(1);
			expect(
				stderrMessages.some((msg) => msg.includes("OpenRouter API error")),
			).toBe(true);
		});
	});

	describe("confirmation", () => {
		test("should skip confirmation with --no-confirm flag", async () => {
			const { exec } = captureExec();
			const { io, stdoutMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			const exitCode = await snapCommand.run({
				args: ["--no-confirm"],
				exec,
				...io,
			});

			expect(exitCode).toBe(0);
			// Should not contain cancellation message
			expect(
				stdoutMessages.some((msg) => msg.includes("Commit cancelled")),
			).toBe(false);
		});
	});

	describe("success messages", () => {
		test("should output success message with commit message", async () => {
			const { calls } = captureExec();
			const { io, stdoutMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			const mockExec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				if (strings.join("").includes("git diff --cached")) {
					return {
						text: async () => "some diff",
					};
				}
				if (strings.join("").includes("git add -A")) {
					return {};
				}
				if (strings.join("").includes("git commit -m")) {
					return {};
				}
				return {};
			};

			await snapCommand.run({
				args: ["--no-confirm"],
				exec: mockExec,
				...io,
			});

			expect(
				stdoutMessages.some((msg) => msg.includes("✅ Commit created:")),
			).toBe(true);
			expect(
				stdoutMessages.some((msg) => msg.includes("feat: add new feature")),
			).toBe(true);
		});

		test("should show generated commit message", async () => {
			const { calls } = captureExec();
			const { io, stdoutMessages } = commandIO();
			process.env.OPENROUTER_API_KEY = "test-key";

			const mockExec = async (
				strings: TemplateStringsArray,
				...values: unknown[]
			) => {
				calls.push({ strings: Array.from(strings), values });
				if (strings.join("").includes("git diff --cached")) {
					return {
						text: async () => "some diff",
					};
				}
				if (strings.join("").includes("git add -A")) {
					return {};
				}
				if (strings.join("").includes("git commit -m")) {
					return {};
				}
				return {};
			};

			await snapCommand.run({
				args: ["--no-confirm"],
				exec: mockExec,
				...io,
			});

			expect(
				stdoutMessages.some((msg) =>
					msg.includes("📝 Generated commit message:"),
				),
			).toBe(true);
		});
	});
});
