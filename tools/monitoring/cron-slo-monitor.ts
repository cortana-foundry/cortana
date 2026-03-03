#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Job = {
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: { kind?: string; expr?: string; everyMs?: number };
  state?: {
    consecutiveErrors?: number;
    lastDurationMs?: number;
    lastRunAtMs?: number;
    nextRunAtMs?: number;
    lastStatus?: string;
    lastRunStatus?: string;
  };
  payload?: { timeoutSeconds?: number };
};

const runtimeJobsPath = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");

function readJobs(): Job[] {
  try {
    const raw = fs.readFileSync(runtimeJobsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

function scheduleLikelyDue(job: Job, now: number): boolean {
  const next = Number(job?.state?.nextRunAtMs || 0);
  if (!next) return false;
  return now - next > 30 * 60 * 1000; // >30m overdue
}

function main() {
  const now = Date.now();
  const jobs = readJobs().filter((j) => j.enabled !== false);
  if (!jobs.length) {
    console.log("NO_REPLY");
    return;
  }

  const erroring = jobs.filter((j) => Number(j?.state?.consecutiveErrors || 0) >= 2);
  const slow = jobs.filter((j) => {
    const d = Number(j?.state?.lastDurationMs || 0);
    const timeoutMs = Number(j?.payload?.timeoutSeconds || 0) * 1000;
    return timeoutMs > 0 && d > timeoutMs * 0.8;
  });
  const missed = jobs.filter((j) => scheduleLikelyDue(j, now));

  if (!erroring.length && !slow.length && !missed.length) {
    console.log("NO_REPLY");
    return;
  }

  const top = (arr: Job[]) => arr.slice(0, 5).map((j) => j.name || j.id || "unknown").join(", ");
  const lines = ["📏 Cron SLO Monitor", "Thresholds exceeded:"];
  if (erroring.length) lines.push(`- consecutiveErrors>=2: ${erroring.length} (${top(erroring)})`);
  if (slow.length) lines.push(`- near-timeout runs (>80% timeout): ${slow.length} (${top(slow)})`);
  if (missed.length) lines.push(`- likely missed schedules (>30m overdue): ${missed.length} (${top(missed)})`);
  console.log(lines.join("\n"));
}

main();
