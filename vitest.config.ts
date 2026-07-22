import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(process.cwd()) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    fileParallelism: false,
    // bcrypt-heavy concurrent PIN/password SQLite tests exceed the 5s default
    // on slower hosts; aborted work can keep writing and poison later cases.
    testTimeout: 20_000,
  },
});
