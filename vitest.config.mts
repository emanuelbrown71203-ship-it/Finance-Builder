import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // On a real database the test files share one sample household, so they take turns. (In memory, each has its own.)
    fileParallelism: !process.env.DATABASE_URL,
  },
});
