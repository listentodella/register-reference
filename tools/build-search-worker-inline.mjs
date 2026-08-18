import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const [fuse, worker] = await Promise.all([
  readFile(resolve(root, "vendor", "fuse.min.js"), "utf8"),
  readFile(resolve(root, "search-worker.js"), "utf8"),
]);
const output = `window.REGISTER_SEARCH_WORKER_SOURCE=${JSON.stringify(`${fuse}\n${worker}`)};\n`;
await writeFile(resolve(root, "search-worker-inline.js"), output, "utf8");
