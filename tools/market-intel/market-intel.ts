#!/usr/bin/env npx tsx
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const py = path.join(scriptDir, "market-intel.py");
const args = process.argv.slice(2);

const r = spawnSync("python3", [py, ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
