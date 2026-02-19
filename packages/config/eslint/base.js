import { defineConfig, globalIgnores } from "eslint/config";

export const baseConfig = defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/build/**",
  ]),
]);

export default baseConfig;
