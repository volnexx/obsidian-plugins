import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: resolve(tmpdir(), "obsidian-git-architecture-baseline-vite"),
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/types/**"],
    passWithNoTests: false
  }
});
