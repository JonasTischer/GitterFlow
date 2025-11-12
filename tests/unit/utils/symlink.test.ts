import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createSymlinks } from "../../../src/utils/symlink";

describe("createSymlinks", () => {
	const testDir = join(import.meta.dir, "../../.tmp/symlink-test");
	const mainRepo = join(testDir, "main");
	const worktree = join(testDir, "worktree");

	beforeEach(() => {
		// Clean up and create test directories
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
		mkdirSync(mainRepo, { recursive: true });
		mkdirSync(worktree, { recursive: true });
	});

	afterEach(() => {
		// Clean up test directories
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	test("should create relative symlinks for files", () => {
		// Create a .env file in main repo
		writeFileSync(join(mainRepo, ".env"), "TEST=value");

		createSymlinks(mainRepo, worktree, [".env"]);

		// Verify symlink was created
		const symlinkPath = join(worktree, ".env");
		expect(existsSync(symlinkPath)).toBe(true);

		// Verify it's a symlink (readlinkSync will throw if not)
		const linkTarget = readlinkSync(symlinkPath);
		expect(linkTarget).toBe("../main/.env");
	});

	test("should create relative symlinks for directories", () => {
		// Create a node_modules directory in main repo
		mkdirSync(join(mainRepo, "node_modules"));

		createSymlinks(mainRepo, worktree, ["node_modules"]);

		// Verify symlink was created
		const symlinkPath = join(worktree, "node_modules");
		expect(existsSync(symlinkPath)).toBe(true);

		// Verify it's a symlink
		const linkTarget = readlinkSync(symlinkPath);
		expect(linkTarget).toBe("../main/node_modules");
	});

	test("should handle multiple files and directories", () => {
		// Create multiple files/dirs in main repo
		writeFileSync(join(mainRepo, ".env"), "TEST=value");
		writeFileSync(join(mainRepo, ".env.local"), "LOCAL=value");
		mkdirSync(join(mainRepo, "node_modules"));
		mkdirSync(join(mainRepo, ".venv"));

		createSymlinks(mainRepo, worktree, [
			".env",
			".env.local",
			"node_modules",
			".venv",
		]);

		// Verify all symlinks were created
		expect(existsSync(join(worktree, ".env"))).toBe(true);
		expect(existsSync(join(worktree, ".env.local"))).toBe(true);
		expect(existsSync(join(worktree, "node_modules"))).toBe(true);
		expect(existsSync(join(worktree, ".venv"))).toBe(true);

		// Verify they're all symlinks with relative paths
		expect(readlinkSync(join(worktree, ".env"))).toBe("../main/.env");
		expect(readlinkSync(join(worktree, ".env.local"))).toBe(
			"../main/.env.local",
		);
		expect(readlinkSync(join(worktree, "node_modules"))).toBe(
			"../main/node_modules",
		);
		expect(readlinkSync(join(worktree, ".venv"))).toBe("../main/.venv");
	});

	test("should skip files that don't exist in main repo", () => {
		// Only create .env, not .env.local
		writeFileSync(join(mainRepo, ".env"), "TEST=value");

		createSymlinks(mainRepo, worktree, [".env", ".env.local"]);

		// .env should be symlinked
		expect(existsSync(join(worktree, ".env"))).toBe(true);

		// .env.local should not exist
		expect(existsSync(join(worktree, ".env.local"))).toBe(false);
	});

	test("should not overwrite existing files in worktree", () => {
		// Create .env in both repos
		writeFileSync(join(mainRepo, ".env"), "MAIN=value");
		writeFileSync(join(worktree, ".env"), "WORKTREE=value");

		createSymlinks(mainRepo, worktree, [".env"]);

		// File should not be overwritten (still contains worktree value)
		const content = Bun.file(join(worktree, ".env")).text();
		expect(content).resolves.toBe("WORKTREE=value");

		// And it should NOT be a symlink
		expect(() => readlinkSync(join(worktree, ".env"))).toThrow();
	});

	test("should handle empty symlink list", () => {
		createSymlinks(mainRepo, worktree, []);

		// Worktree should be empty
		const files = readdirSync(worktree);
		expect(files.length).toBe(0);
	});

	test("should create correct relative paths when worktree is in different location", () => {
		// Create a worktree that's a sibling to main repo (typical git worktree setup)
		const siblingWorktree = join(testDir, "feature-branch");
		mkdirSync(siblingWorktree, { recursive: true });

		writeFileSync(join(mainRepo, ".env"), "TEST=value");

		createSymlinks(mainRepo, siblingWorktree, [".env"]);

		// Symlink should point to ../main/.env (relative to siblingWorktree)
		const linkTarget = readlinkSync(join(siblingWorktree, ".env"));
		expect(linkTarget).toBe("../main/.env");
	});

	test("should handle nested paths (e.g., backend/.env)", () => {
		// Create nested directory structure in main repo
		mkdirSync(join(mainRepo, "backend"), { recursive: true });
		writeFileSync(join(mainRepo, "backend", ".env"), "BACKEND=value");

		// Create matching directory structure in worktree
		mkdirSync(join(worktree, "backend"), { recursive: true });

		createSymlinks(mainRepo, worktree, ["backend/.env"]);

		// Symlink should be created at backend/.env
		const symlinkPath = join(worktree, "backend", ".env");
		expect(existsSync(symlinkPath)).toBe(true);

		// Verify it's a symlink with correct relative path
		const linkTarget = readlinkSync(symlinkPath);
		expect(linkTarget).toBe("../../main/backend/.env");
	});

	test("should create parent directories if they don't exist in worktree", () => {
		// Create nested directory only in main repo
		mkdirSync(join(mainRepo, "backend"), { recursive: true });
		writeFileSync(join(mainRepo, "backend", ".env"), "BACKEND=value");

		// Don't create backend/ in worktree - it should be created automatically
		createSymlinks(mainRepo, worktree, ["backend/.env"]);

		// Symlink should be created at backend/.env
		const symlinkPath = join(worktree, "backend", ".env");
		expect(existsSync(symlinkPath)).toBe(true);

		// Verify it's a symlink
		const linkTarget = readlinkSync(symlinkPath);
		expect(linkTarget).toBe("../../main/backend/.env");
	});
});
