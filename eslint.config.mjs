import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored, gitignored runtime copied in by scripts/copy-mediapipe.mjs
    // at dev/build time. It's Google's own Emscripten build output, not
    // something we wrote, so it has no business being linted as our code.
    "public/mediapipe/**",
  ]),
]);

export default eslintConfig;
