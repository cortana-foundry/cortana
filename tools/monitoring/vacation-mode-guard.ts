#!/usr/bin/env -S npx tsx
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVacationOpsConfig } from "../vacation/vacation-config.js";
import { getActiveVacationWindow, reconcileVacationMirror } from "../vacation/vacation-state.js";
import { disableVacationMode } from "../vacation/vacation-state-machine.js";

type CronJob = {
  id?: string;
  name?: string;
  enabled?: boolean;
  state?: {
    consecutiveErrors?: number;
  };
  updatedAtMs?: number;
};

type RuntimeJobsDoc = {
  jobs?: CronJob[];
};

const RUNTIME_JOBS_PATH = path.join(os.homedir(), ".openclaw", "cron", "jobs.json");
const QUARANTINE_DIR = path.join(os.homedir(), ".openclaw", "cron", "quarantine");

function readRuntimeJobs(): RuntimeJobsDoc | null {
  try {
    return JSON.parse(fs.readFileSync(RUNTIME_JOBS_PATH, "utf8")) as RuntimeJobsDoc;
  } catch {
    return null;
  }
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function shouldMatch(name: string, matchers: string[]): boolean {
  const haystack = normalize(name);
  return matchers.some((matcher) => haystack.includes(normalize(matcher)));
}

function quarantineJob(job: CronJob): void {
  fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
  const safeName = (job.name ?? job.id ?? "unknown").replace(/[\\/]/g, "_");
  const quarantineFile = path.join(QUARANTINE_DIR, `${safeName}.quarantined`);
  const content = `${new Date().toISOString()} vacation-mode fragile quarantine (consecutive errors)\n`;
  fs.writeFileSync(quarantineFile, content, "utf8");
}

function main(): void {
  const config = loadVacationOpsConfig();
  const activeWindow = getActiveVacationWindow();
  if (!activeWindow) {
    console.log("NO_REPLY");
    return;
  }

  if (Date.now() >= Date.parse(activeWindow.end_at)) {
    const expired = disableVacationMode({ config, reason: "expired" });
    console.log(expired.summaryText);
    return;
  }

  reconcileVacationMirror();

  const doc = readRuntimeJobs();
  if (!doc || !Array.isArray(doc.jobs)) {
    console.log("🏖️ Vacation mode actionable failure.\n- control_plane: runtime cron jobs unavailable");
    return;
  }

  const threshold = Math.max(1, Number(config.guard.quarantineAfterConsecutiveErrors || 1));
  const matchers = config.guard.fragileCronMatchers;
  const quarantined: string[] = [];
  const now = Date.now();

  for (const job of doc.jobs) {
    if (job.enabled === false) continue;
    const name = String(job.name ?? "");
    if (!name || !shouldMatch(name, matchers)) continue;
    const consecutiveErrors = Number(job.state?.consecutiveErrors ?? 0);
    if (consecutiveErrors < threshold) continue;

    job.enabled = false;
    job.updatedAtMs = now;
    quarantineJob(job);
    quarantined.push(name);
  }

  if (!quarantined.length) {
    console.log("NO_REPLY");
    return;
  }

  fs.writeFileSync(RUNTIME_JOBS_PATH, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(
    [
      "🏖️ Vacation mode quarantined fragile cron jobs.",
      `- control_plane: disabled=${quarantined.length} jobs (${quarantined.slice(0, 4).join(", ")})`,
    ].join("\n")
  );
}

main();
