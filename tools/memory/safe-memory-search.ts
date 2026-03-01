#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { readJsonFile, writeJsonFileAtomic } from "../lib/json-file.js";
import { resolveRepoPath } from "../lib/paths.js";

export function runCli(argv = process.argv.slice(2)): number {
  const query = argv.join(" ").trim();
  if (!query) {
    console.log("usage: safe-memory-search.ts <query>");
    return 2;
  }

  const repo = resolveRepoPath();
  const statePath = path.join(repo, "memory", "vector-health-state.json");
  const state = readJsonFile<Record<string, any>>(statePath) ?? {};

  const vector = spawnSync("openclaw", ["memory", "search", query, "--json"], { encoding: "utf8" }) as any;
  if ((vector?.status ?? 1) === 0) {
    const results = JSON.parse(vector?.stdout || "[]");
    console.log(JSON.stringify({ mode: "vector", results }));
    return 0;
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const files: string[] = [];
  const memoryFile = path.join(repo, "MEMORY.md");
  if (fs.existsSync(memoryFile)) files.push(memoryFile);
  const dailyDir = path.join(repo, "memory");
  if (fs.existsSync(dailyDir)) {
    for (const name of fs.readdirSync(dailyDir)) {
      if (name.endsWith(".md")) files.push(path.join(dailyDir, name));
    }
  }

  const results = files
    .map((f) => ({ file: f, text: String(fs.readFileSync(f, "utf8")) }))
    .filter((r) => terms.every((t) => r.text.toLowerCase().includes(t)))
    .map((r) => ({ file: r.file }));

  writeJsonFileAtomic(statePath, {
    ...state,
    fallback_mode: true,
    last_fallback_at: new Date().toISOString(),
  });

  console.log(JSON.stringify({ mode: "keyword_fallback", results }));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runCli());
}
