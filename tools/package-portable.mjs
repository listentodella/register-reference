import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const releaseDir = resolve(root, "src-tauri", "target", "release");
const portableDir = resolve(releaseDir, "portable");
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const architecture = process.arch === "x64" ? "x86_64" : process.arch;
const outputPrefix = `register-reference-v${version}`;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
  }
}

await rm(portableDir, { recursive: true, force: true });
await mkdir(portableDir, { recursive: true });

const outputs = [];

if (process.platform === "darwin") {
  const appBundle = resolve(releaseDir, "bundle", "macos", "寄存器速查工具.app");
  run("codesign", ["--force", "--deep", "--sign", "-", appBundle]);
  run("codesign", ["--verify", "--deep", "--strict", appBundle]);
  const output = resolve(portableDir, `${outputPrefix}-macos-${architecture}.zip`);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appBundle, output]);
  outputs.push(output);
} else if (process.platform === "win32") {
  const executable = resolve(releaseDir, "register-reference.exe");
  const output = resolve(portableDir, `${outputPrefix}-windows-${architecture}.exe`);
  await copyFile(executable, output);
  outputs.push(output);
} else if (process.platform === "linux") {
  const appImageDir = resolve(releaseDir, "bundle", "appimage");
  const appImageName = (await readdir(appImageDir)).find((fileName) => fileName.endsWith(".AppImage"));
  if (!appImageName) throw new Error(`missing AppImage in ${appImageDir}`);
  const output = resolve(portableDir, `${outputPrefix}-linux-${architecture}.AppImage`);
  await copyFile(resolve(appImageDir, appImageName), output);
  await chmod(output, 0o755);
  outputs.push(output);
} else {
  throw new Error(`unsupported portable package platform: ${process.platform}`);
}

const checksumLines = [];
for (const output of outputs) {
  const digest = createHash("sha256").update(await readFile(output)).digest("hex");
  checksumLines.push(`${digest}  ${basename(output)}`);
}
await writeFile(resolve(portableDir, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");

console.log(`wrote portable package to ${portableDir}`);
