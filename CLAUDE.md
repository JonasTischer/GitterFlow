---
description: Use Bun instead of Node.js, npm, pnpm, or vite. Follow TDD approach.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json, *.test.ts"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## Test-Driven Development (TDD)

This project follows a strict TDD approach:

### TDD Workflow

1. **Write the test FIRST** - Before implementing any feature, write a failing test
2. **Run the test** - Verify it fails for the right reason
3. **Write minimal code** - Implement just enough to make the test pass
4. **Run tests again** - Verify the test now passes
5. **Refactor** - Clean up code while keeping tests green
6. **Repeat** - Continue the cycle for each new feature

### File Naming Conventions

- Test files: `*.test.ts` (e.g., `create.test.ts`, `git.test.ts`)
- Place tests alongside source files or in `tests/` directory
- Test files are automatically discovered by `bun test`

### Example TDD Cycle

```ts
// 1. Write test FIRST (tests/commands/create.test.ts)
import { test, expect, describe } from "bun:test";
import { createWorktree } from "../../src/commands/create";

describe("gf create", () => {
  test("should create a new git worktree", async () => {
    const result = await createWorktree("feature-branch");
    expect(result.success).toBe(true);
    expect(result.path).toContain("feature-branch");
  });
});

// 2. Run test - it fails (function doesn't exist yet)
// $ bun test

// 3. Write minimal implementation (src/commands/create.ts)
export async function createWorktree(branch: string) {
  return { success: true, path: `../${branch}` };
}

// 4. Run test again - it passes
// $ bun test

// 5. Refactor and add more tests
```

### Code Coverage Requirements

- Maintain minimum 80% code coverage
- Run tests with coverage: `bun test --coverage`
- Coverage thresholds enforced in CI
- View coverage report in `coverage/` directory

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests. Import from `bun:test` module.

### Basic Test Structure

```ts#index.test.ts
import { test, expect, describe } from "bun:test";

describe("feature name", () => {
  test("should do something specific", () => {
    expect(1 + 1).toBe(2);
  });

  test("async operations", async () => {
    const result = await Promise.resolve(42);
    expect(result).toBe(42);
  });
});
```

### Common Test Patterns

```ts
// Testing functions
test("addition", () => {
  expect(add(2, 2)).toBe(4);
});

// Testing async code
test("fetch data", async () => {
  const data = await fetchData();
  expect(data).toBeDefined();
  expect(data.id).toBeGreaterThan(0);
});

// Testing errors
test("throws on invalid input", () => {
  expect(() => divide(10, 0)).toThrow("Division by zero");
});

// Using mocks
import { mock } from "bun:test";
test("with mocks", () => {
  const mockFn = mock(() => "mocked value");
  const result = mockFn();
  expect(mockFn).toHaveBeenCalled();
  expect(result).toBe("mocked value");
});

// Testing CLI commands (for GitterFlow)
test("git operations", async () => {
  const result = await $`git status`.text();
  expect(result).toContain("On branch");
});
```

### Test Utilities

- `test.skip()` - Skip a test temporarily
- `test.only()` - Run only this test
- `test.todo()` - Mark test as TODO
- `test.each([...])` - Parametrized tests
- `expect.hasAssertions()` - Ensure at least one assertion runs
- `expect.assertions(n)` - Ensure exactly n assertions run

### Running Tests

```bash
bun test                          # Run all tests
bun test --watch                  # Watch mode (re-run on file changes)
bun test --coverage               # With coverage report
bun test path/to/file.test.ts     # Run specific test file
bun test --only                   # Run only tests marked with .only()
bun test --timeout 10000          # Set timeout (ms)
```

### Mocking

```ts
import { mock, spyOn } from "bun:test";

// Mock functions
const fn = mock(() => 42);
fn();
expect(fn).toHaveBeenCalledTimes(1);

// Spy on methods
const obj = { method: () => "original" };
const spy = spyOn(obj, "method");
obj.method();
expect(spy).toHaveBeenCalled();

// Mock modules
mock.module("./config", () => ({
  API_KEY: "test-key"
}));
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";

// import .css files directly and it works
import './index.css';

import { createRoot } from "react-dom/client";

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md`.
