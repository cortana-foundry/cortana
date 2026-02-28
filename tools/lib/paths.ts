import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

export function getScriptDir(importMetaUrl: string): string {
  return path.dirname(fileURLToPath(importMetaUrl));
}

export function findRepoRoot(startDir?: string): string {
  let dir = startDir ?? getScriptDir(import.meta.url);
  for (let i = 0; i < 12; i += 1) {
    if (
      fs.existsSync(path.join(dir, "AGENTS.md")) ||
      fs.existsSync(path.join(dir, ".git"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return startDir ?? process.cwd();
}

const cachedRepoRoot = findRepoRoot();

export function repoRoot(): string {
  return cachedRepoRoot;
}

export function resolveRepoPath(...segments: string[]): string {
  return path.join(cachedRepoRoot, ...segments);
}

export function resolveHomePath(...segments: string[]): string {
  return path.join(os.homedir(), ...segments);
}
