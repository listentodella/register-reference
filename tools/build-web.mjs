import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "data"), { recursive: true });
await mkdir(resolve(dist, "vendor"), { recursive: true });

for (const file of ["index.html", "styles.css", "yaml-lite.js", "yaml-validator.js", "app.js"]) {
  await cp(resolve(root, file), resolve(dist, file));
}

await cp(resolve(root, "data", "chips.data.js"), resolve(dist, "data", "chips.data.js"));
await cp(resolve(root, "favicon.png"), resolve(dist, "favicon.png"));
await cp(resolve(root, "vendor", "lucide.min.js"), resolve(dist, "vendor", "lucide.min.js"));
await cp(resolve(root, "vendor", "jsep.min.js"), resolve(dist, "vendor", "jsep.min.js"));

console.log(`wrote ${dist}`);
