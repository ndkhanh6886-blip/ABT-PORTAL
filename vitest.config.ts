import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    globalSetup: ["src/factory/__tests__/globalSetup.ts"],
    env: { FACTORY_PGDATABASE: "abt_factory_test", NODE_ENV: "test" },
    // DB tests share one test database
    fileParallelism: false,
    testTimeout: 20000,
  },
});
