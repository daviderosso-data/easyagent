import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

// Flat config (Next 16 removed `next lint`; ESLint is run directly). Keeps the
// Next core-web-vitals rules plus TypeScript recommended, tuned for this repo.
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // The agent runner deliberately uses `any` at the SDK boundary (the SDK's
      // streamed message/tool shapes are untyped); it's opted-in per-file.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Tests and Node tooling scripts.
    files: ["tests/**/*.ts", "*.mts", "*.mjs"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
