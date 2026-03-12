#!/usr/bin/env npx tsx
import fs from "fs";
import os from "os";
import path from "path";

const VOLATILE_KEYS = new Set([
  "state",
  "updatedAtMs",
  "lastRunAtMs",
  "nextRunAtMs",
  "lastStatus",
  "lastRunStatus",
  "lastDurationMs",
  "lastDeliveryStatus",
  "lastDelivered",
  "consecutiveErrors",
  "reconciledAt",
  "reconciledReason",
  "runningAtMs",
  "lastError",
]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (VOLATILE_KEYS.has(key)) continue;
    out[key] = stripVolatile(inner);
  }
  return out;
}

function digest(value: unknown): string {
  return JSON.stringify(value);
}

async function main() {
  const runtime = path.join(os.homedir(), ".openclaw/cron/jobs.json");
  const repo = "/Users/hd/openclaw/config/cron/jobs.json";
  if (!fs.existsSync(runtime)) {
    console.log('{"error":"runtime jobs.json missing"}');
    process.exit(1);
  }

  const runtimeRaw = JSON.parse(fs.readFileSync(runtime, "utf8")) as { jobs?: Array<Record<string, unknown>>; [key: string]: unknown };
  const repoRaw = JSON.parse(fs.readFileSync(repo, "utf8")) as { jobs?: Array<Record<string, unknown>>; [key: string]: unknown };
  const runtimeJobs = Array.isArray(runtimeRaw.jobs) ? runtimeRaw.jobs : [];
  const repoJobs = Array.isArray(repoRaw.jobs) ? repoRaw.jobs : [];
  const runtimeById = new Map(runtimeJobs.map((job) => [String(job.id ?? ""), job]));

  let changed = false;
  const mergedJobs = repoJobs.map((repoJob) => {
    const id = String(repoJob.id ?? "");
    const runtimeJob = runtimeById.get(id);
    if (!runtimeJob) return repoJob;

    if (digest(stripVolatile(repoJob)) === digest(stripVolatile(runtimeJob))) {
      return repoJob;
    }

    changed = true;
    const merged: Record<string, unknown> = { ...repoJob };
    for (const [key, value] of Object.entries(runtimeJob)) {
      if (VOLATILE_KEYS.has(key)) continue;
      merged[key] = value;
    }
    return merged;
  });

  if (!changed) {
    console.log('{"synced":false,"reason":"already in sync or runtime-only drift suppressed"}');
    process.exit(0);
  }

  const merged = { ...repoRaw, jobs: mergedJobs };
  fs.writeFileSync(repo, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  console.log('{"synced":true,"mode":"semantic","from":"runtime","to":"repo"}');
}
main();
