// Copies MediaPipe's WebAssembly runtime out of node_modules into public/, so
// the live demo serves it from its own origin at exactly the version the JS
// expects. Runs before dev and build; the copies are gitignored.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const target = join(root, "public", "mediapipe", "wasm");

if (!existsSync(source)) {
  console.error("copy-mediapipe: @mediapipe/tasks-vision isn't installed. Run npm install.");
  process.exit(1);
}

mkdirSync(target, { recursive: true });
// FilesetResolver picks the SIMD build or the no-SIMD fallback; the "module"
// variant is only for bundler-module loading, which the demo doesn't use.
const files = readdirSync(source).filter((name) => !name.includes("_module_"));
for (const name of files) copyFileSync(join(source, name), join(target, name));
console.log(`copy-mediapipe: ${files.length} files -> public/mediapipe/wasm`);
