import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Server-side security/lifecycle modules are plain TS with no DOM — run them in
// a Node environment. tsconfigPaths resolves the "@/..." alias used in src.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
