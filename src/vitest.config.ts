import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.join(__dirname, "shared")
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    // Tests should never spawn Electron or hit native modules; this keeps
    // the suite portable to CI (Linux runners with no display server).
    pool: "threads",
    reporters: process.env.CI ? ["default"] : ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["shared/**", "main/ai/**", "main/security/**"],
      exclude: ["**/*.d.ts", "**/index.ts"]
    }
  }
});
