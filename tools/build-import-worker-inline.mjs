import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sources = await Promise.all([
  "yaml-lite.js",
  "yaml-validator.js",
  "translation-validator.js",
  "import-worker.js",
].map((file) => readFile(resolve(root, file), "utf8")));
const workerSource = `self.window=self;\n${sources.join("\n")}`;
const output = `window.REGISTER_IMPORT_WORKER_SOURCE=${JSON.stringify(workerSource)};\n`;
await writeFile(resolve(root, "import-worker-inline.js"), output, "utf8");
