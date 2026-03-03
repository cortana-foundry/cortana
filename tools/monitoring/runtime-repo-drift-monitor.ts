#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const runtimeJobs = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");
const repoJobs = "/Users/hd/openclaw/config/cron/jobs.json";
const runtimeProfiles = path.join(os.homedir(), ".openclaw", "agent-profiles.json");
const repoProfiles = "/Users/hd/openclaw/config/agent-profiles.json";

function digest(file: string): string | null {
  try {
    const b = fs.readFileSync(file);
    return crypto.createHash("sha256").update(b).digest("hex");
  } catch {
    return null;
  }
}

function main() {
  const checks = [
    ["cron/jobs.json", runtimeJobs, repoJobs],
    ["agent-profiles.json", runtimeProfiles, repoProfiles],
  ] as const;

  const drift: string[] = [];
  for (const [label, runtime, repo] of checks) {
    const r = digest(runtime);
    const p = digest(repo);
    if (!r || !p) {
      drift.push(`${label}: missing file(s)`);
      continue;
    }
    if (r !== p) drift.push(`${label}: checksum mismatch`);
  }

  if (!drift.length) {
    console.log("NO_REPLY");
    return;
  }

  console.log(["🧭 Runtime/Repo Drift Detected", ...drift.map((d) => `- ${d}`)].join("\n"));
}

main();
