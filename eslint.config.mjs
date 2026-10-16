import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["tests/**/*.cjs", "desktop/**/*.cjs", "electron-builder.cjs"],
    // The unit runner installs a CommonJS hook to exercise the real TS modules.
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Runtime artifacts (gitignored): debug logs, dumps and preview renders.
    "logs/**",
    "preview/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
