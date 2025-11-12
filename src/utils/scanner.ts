import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Patterns to look for when scanning for symlink candidates
 */
const SYMLINK_PATTERNS = {
	envFiles: /^\.env(\..+)?$/,
	dependencyDirs: /^(node_modules|vendor|\.venv|venv)$/,
	buildDirs: /^(build|dist|out|target)$/,
	cacheDirs: /^(\.cache|\.next|\.nuxt|\.turbo)$/,
};

/**
 * Directories to exclude from scanning
 */
const EXCLUDED_DIRS = new Set([
	".git",
	".github",
	".vscode",
	".idea",
	"src",
	"tests",
	"test",
	"__tests__",
	"docs",
	"public",
	"static",
	"assets",
	"components",
	"pages",
	"lib",
	"utils",
	"config",
]);

/**
 * Maximum depth to search for symlink candidates
 */
const MAX_SEARCH_DEPTH = 3;

/**
 * Check if a file/directory matches symlink candidate patterns
 */
function isSymlinkCandidate(name: string, isDirectory: boolean): boolean {
	// Check env files (both files and directories)
	if (SYMLINK_PATTERNS.envFiles.test(name)) {
		return true;
	}

	// Rest are directory-only patterns
	if (!isDirectory) {
		return false;
	}

	return (
		SYMLINK_PATTERNS.dependencyDirs.test(name) ||
		SYMLINK_PATTERNS.buildDirs.test(name) ||
		SYMLINK_PATTERNS.cacheDirs.test(name)
	);
}

/**
 * Recursively scan directory for symlink candidates
 */
function scanDirectory(
	dirPath: string,
	rootPath: string,
	depth: number,
	results: string[],
): void {
	// Stop if we've reached max depth
	if (depth > MAX_SEARCH_DEPTH) {
		return;
	}

	try {
		const entries = readdirSync(dirPath, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = join(dirPath, entry.name);
			const relativePath = relative(rootPath, entryPath);

			// Skip excluded directories
			if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
				continue;
			}

			// Check if this entry is a symlink candidate
			if (isSymlinkCandidate(entry.name, entry.isDirectory())) {
				results.push(relativePath);
				// Don't recurse into directories we're already adding
				continue;
			}

			// Recurse into directories
			if (entry.isDirectory()) {
				scanDirectory(entryPath, rootPath, depth + 1, results);
			}
		}
	} catch {
		// Silently skip directories we can't read
		// (permissions, broken symlinks, etc.)
	}
}

/**
 * Scan a repository for files/directories that are good candidates for symlinking
 * Returns an array of relative paths from the repository root
 *
 * @param repoPath - Absolute path to the repository root
 * @returns Array of relative paths to symlink candidates
 */
export function scanForSymlinkCandidates(repoPath: string): string[] {
	const results: string[] = [];
	scanDirectory(repoPath, repoPath, 0, results);
	return results.sort();
}
