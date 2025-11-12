import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanForSymlinkCandidates } from "../../../src/utils/scanner";

describe("scanForSymlinkCandidates", () => {
	const testDir = join(import.meta.dir, "../../.tmp/scanner-test");

	beforeEach(() => {
		// Clean up and create test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directory
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("should find .env files in root directory", () => {
		writeFileSync(join(testDir, ".env"), "TEST=value");

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".env");
	});

	test("should find nested .env files", () => {
		mkdirSync(join(testDir, "backend"), { recursive: true });
		writeFileSync(join(testDir, "backend", ".env"), "TEST=value");

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("backend/.env");
	});

	test("should find .env variants (.env.local, .env.development, etc.)", () => {
		writeFileSync(join(testDir, ".env.local"), "");
		writeFileSync(join(testDir, ".env.development"), "");
		writeFileSync(join(testDir, ".env.production"), "");

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".env.local");
		expect(candidates).toContain(".env.development");
		expect(candidates).toContain(".env.production");
	});

	test("should find node_modules directories", () => {
		mkdirSync(join(testDir, "node_modules"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("node_modules");
	});

	test("should find nested node_modules directories", () => {
		mkdirSync(join(testDir, "frontend"), { recursive: true });
		mkdirSync(join(testDir, "frontend", "node_modules"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("frontend/node_modules");
	});

	test("should find .venv directories", () => {
		mkdirSync(join(testDir, ".venv"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".venv");
	});

	test("should find nested .venv directories", () => {
		mkdirSync(join(testDir, "backend"), { recursive: true });
		mkdirSync(join(testDir, "backend", ".venv"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("backend/.venv");
	});

	test("should find venv directories (without dot)", () => {
		mkdirSync(join(testDir, "venv"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("venv");
	});

	test("should find vendor directories", () => {
		mkdirSync(join(testDir, "vendor"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("vendor");
	});

	test("should find build output directories", () => {
		mkdirSync(join(testDir, "build"), { recursive: true });
		mkdirSync(join(testDir, "dist"), { recursive: true });
		mkdirSync(join(testDir, "out"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain("build");
		expect(candidates).toContain("dist");
		expect(candidates).toContain("out");
	});

	test("should NOT include .git directory", () => {
		mkdirSync(join(testDir, ".git"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).not.toContain(".git");
	});

	test("should NOT include source code files", () => {
		writeFileSync(join(testDir, "index.ts"), "");
		writeFileSync(join(testDir, "main.py"), "");

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).not.toContain("index.ts");
		expect(candidates).not.toContain("main.py");
	});

	test("should return empty array for empty directory", () => {
		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toEqual([]);
	});

	test("should handle complex project structure", () => {
		// Frontend
		mkdirSync(join(testDir, "frontend"), { recursive: true });
		writeFileSync(join(testDir, "frontend", ".env.local"), "");
		mkdirSync(join(testDir, "frontend", "node_modules"), { recursive: true });

		// Backend
		mkdirSync(join(testDir, "backend"), { recursive: true });
		writeFileSync(join(testDir, "backend", ".env"), "");
		mkdirSync(join(testDir, "backend", ".venv"), { recursive: true });

		// Root level
		writeFileSync(join(testDir, ".env"), "");

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".env");
		expect(candidates).toContain("frontend/.env.local");
		expect(candidates).toContain("frontend/node_modules");
		expect(candidates).toContain("backend/.env");
		expect(candidates).toContain("backend/.venv");
	});

	test("should find .cache directories", () => {
		mkdirSync(join(testDir, ".cache"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".cache");
	});

	test("should find framework-specific cache directories", () => {
		mkdirSync(join(testDir, ".next"), { recursive: true });
		mkdirSync(join(testDir, ".nuxt"), { recursive: true });

		const candidates = scanForSymlinkCandidates(testDir);

		expect(candidates).toContain(".next");
		expect(candidates).toContain(".nuxt");
	});

	test("should limit search depth to avoid deep nested directories", () => {
		// Create a very deep structure
		mkdirSync(
			join(
				testDir,
				"level1",
				"level2",
				"level3",
				"level4",
				"level5",
				"node_modules",
			),
			{ recursive: true },
		);

		const candidates = scanForSymlinkCandidates(testDir);

		// Should not find node_modules 5 levels deep
		expect(candidates).not.toContain(
			"level1/level2/level3/level4/level5/node_modules",
		);
	});
});
