#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseBinary = join(packageRoot, "src-tauri", "target", "release", process.platform === "win32" ? "diffit.exe" : "diffit");
const debugBinary = join(packageRoot, "src-tauri", "target", "debug", process.platform === "win32" ? "diffit.exe" : "diffit");
const binary = existsSync(releaseBinary) ? releaseBinary : existsSync(debugBinary) ? debugBinary : null;

if (!binary) {
  console.error("Diffit has not been built yet. Run `bun run build` first, then run `bun link` if you want the `diffit` command globally.");
  process.exit(1);
}

const child = spawn(binary, process.argv.slice(2), {
  cwd: process.cwd(),
  detached: true,
  stdio: "ignore",
});

child.unref();
