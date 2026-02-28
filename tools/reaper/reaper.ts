#!/usr/bin/env npx tsx

import fs from "fs";
import { spawnSync } from "child_process";
import { resolveHomePath } from "../lib/paths.js";
import { readJsonFile, writeJsonFileAtomic } from "../lib/json-file.js";

const RUN_STORE_PATH = process.env.OPENCLAW_SUBAGENT_RUNS_PATH
  ? process.env.OPENCLAW_SUBAGENT_RUNS_PATH
  : resolveHomePath(".openclaw", "subagents", "runs.json");
const DB_NAME = "cortana";
const ACTIVE_MINUTES = 1440;
const STALE_STATUSES = new Set(["running", "in_progress"]);

function nowMs(): number {
  return Math.trunc(Date.now());
}

function isoFromMs(ms?: number | null): string | null {
  if (!ms) return null;
  return new Date(ms).toISOString();
}

function loadJson(filePath: string, fallback: any): any {
  if (!fs.existsSync(filePath)) return fallback;
  const parsed = readJsonFile<any>(filePath);
  return parsed ?? fallback;
}

function saveJson(filePath: string, data: any): void {
  writeJsonFileAtomic(filePath, data, 2);
}

function resolvePsql(): string {
  const candidates = [process.env.PSQL_BIN, "/opt/homebrew/opt/postgresql@17/bin/psql", "psql"].filter(
    Boolean
  ) as string[];
  for (const c of candidates) {
    if (c === "psql") {
      const proc = spawnSync("/usr/bin/env", ["bash", "-lc", "command -v psql"], { encoding: "utf8" });
      if (proc.status === 0 && (proc.stdout ?? "").trim()) return "psql";
      continue;
    }
    if (fs.existsSync(c)) return c;
  }
  return "psql";
}

function runSessions(activeMinutes = ACTIVE_MINUTES): any {
  const cmd = ["openclaw", "sessions", "--json", "--active", String(activeMinutes), "--all-agents"];
  const proc = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
  if (proc.status !== 0) {
    const msg = (proc.stderr ?? proc.stdout ?? "openclaw sessions failed").trim();
    throw new Error(msg);
  }
  try {
    return JSON.parse(proc.stdout ?? "");
  } catch (err) {
    throw new Error(`Invalid JSON from openclaw sessions: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sqlQuote(value: string | null): string {
  return (value || "").replace(/'/g, "''");
}

function collectSessionIds(session: Record<string, any>): Set<string> {
  const ids = new Set<string>();
  const cand = [session.sessionId, session.runId, session.run_id, session.key];
  for (const v of cand) {
    const s = String(v ?? "").trim();
    if (s) ids.add(s);
  }
  return ids;
}

function collectRunIds(run: Record<string, any>): Set<string> {
  const ids = new Set<string>();
  const cand = [run.childSessionKey, run.runId, run.sessionId];
  for (const v of cand) {
    const s = String(v ?? "").trim();
    if (s) ids.add(s);
  }
  return ids;
}

function logReapedEvent(psqlBin: string, metadata: Record<string, any>, message: string): [boolean, string | null] {
  const msgSql = message.replace(/'/g, "''");
  const metaSql = JSON.stringify(metadata).replace(/'/g, "''");
  const sql =
    "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES (" +
    "'subagent_reaped', 'subagent-reaper', 'warning', " +
    `'${msgSql}', '${metaSql}'::jsonb` +
    ");";

  try {
    const proc = spawnSync(psqlBin, [DB_NAME, "-X", "-c", sql], { encoding: "utf8" });
    if (proc.status !== 0) {
      return [false, (proc.stderr ?? proc.stdout ?? "psql insert failed").trim()];
    }
    return [true, null];
  } catch (err) {
    return [false, `psql not found (${psqlBin})`];
  }
}

function resetTasks(
  psqlBin: string,
  runId: string,
  label: string | null,
  childKey: string | null,
  outcome: string
): [boolean, string | null, number] {
  const conditions: string[] = [];
  const runQ = sqlQuote(runId);
  const labelQ = sqlQuote(label);
  const childQ = sqlQuote(childKey);

  if (runId) {
    conditions.push(`run_id='${runQ}'`);
    conditions.push(`COALESCE(metadata->>'subagent_run_id','')='${runQ}'`);
  }
  if (label) {
    conditions.push(`assigned_to='${labelQ}'`);
    conditions.push(`COALESCE(metadata->>'subagent_label','')='${labelQ}'`);
  }
  if (childKey) {
    conditions.push(`assigned_to='${childQ}'`);
    conditions.push(`COALESCE(metadata->>'subagent_session_key','')='${childQ}'`);
  }

  if (!conditions.length) return [true, null, 0];

  const outcomeQ = sqlQuote(outcome);
  const sql =
    "UPDATE cortana_tasks SET " +
    `status='ready', outcome='${outcomeQ}', updated_at=NOW() ` +
    "WHERE status='in_progress' AND (" +
    conditions.join(" OR ") +
    ") RETURNING id;";

  const proc = spawnSync(psqlBin, [DB_NAME, "-X", "-t", "-A", "-c", sql], { encoding: "utf8" });
  if (proc.status !== 0) {
    return [false, (proc.stderr ?? proc.stdout ?? "task update failed").trim(), 0];
  }

  const rows = (proc.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return [true, null, rows.length];
}

type Args = { maxAgeHours: number; dryRun: boolean; emitJson: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { maxAgeHours: 2.0, dryRun: false, emitJson: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--max-age-hours":
        args.maxAgeHours = Number(argv[i + 1]);
        i += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--emit-json":
        args.emitJson = true;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const now = nowMs();
  const maxAgeMs = Math.trunc(args.maxAgeHours * 3600 * 1000);

  const output: Record<string, any> = {
    ok: true,
    timestamp: isoFromMs(now),
    config: { maxAgeHours: args.maxAgeHours, dryRun: args.dryRun },
    summary: {
      runsScanned: 0,
      staleCandidates: 0,
      reapedRuns: 0,
      eventsLogged: 0,
      tasksReset: 0,
      errors: 0,
    },
    reaped: [],
    errors: [],
  };

  const payload = loadJson(RUN_STORE_PATH, {});
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    output.ok = false;
    output.error = "runs.json payload is not an object";
    if (args.emitJson) console.log(JSON.stringify(output, null, 2));
    else console.log("reaper: runs.json payload invalid");
    process.exit(1);
  }

  const runs = (payload as any).runs;
  if (!runs || typeof runs !== "object") {
    output.ok = false;
    output.error = "runs.json missing runs map";
    if (args.emitJson) console.log(JSON.stringify(output, null, 2));
    else console.log("reaper: runs.json missing runs map");
    process.exit(1);
  }

  output.summary.runsScanned = Object.keys(runs).length;

  let sessionData: any;
  try {
    sessionData = runSessions(ACTIVE_MINUTES);
  } catch (e) {
    output.ok = false;
    output.error = String(e instanceof Error ? e.message : e);
    if (args.emitJson) console.log(JSON.stringify(output, null, 2));
    else console.log(`reaper: ${output.error}`);
    process.exit(1);
  }

  const sessions: Record<string, any>[] = Array.isArray(sessionData.sessions) ? sessionData.sessions : [];
  const activeIds = new Set<string>();
  for (const session of sessions) {
    if (session && typeof session === "object") {
      for (const id of collectSessionIds(session)) activeIds.add(id);
    }
  }

  const psqlBin = resolvePsql();
  let changed = false;

  for (const [runKey, run] of Object.entries(runs)) {
    if (!run || typeof run !== "object") continue;

    const status = String((run as any).status ?? "").trim().toLowerCase();
    if (!STALE_STATUSES.has(status)) continue;

    const startedAt = (run as any).startedAt;
    if (typeof startedAt !== "number") continue;

    const ageMs = now - Math.trunc(startedAt);
    if (ageMs <= maxAgeMs) continue;

    output.summary.staleCandidates += 1;
    const runIds = collectRunIds(run as any);
    const isActive = Array.from(runIds).some((id) => activeIds.has(id));
    if (isActive) continue;

    const label = (run as any).label ?? null;
    const runId = String((run as any).runId ?? "");
    const childKey = String((run as any).childSessionKey ?? "");
    const ageHours = Math.round((ageMs / 3600000) * 100) / 100;

    const outcomeText =
      "Reaped stale sub-agent session " +
      `${label || childKey || runId || runKey} ` +
      `after ${ageHours}h without activity.`;

    const entry: Record<string, any> = {
      runKey,
      runId: runId || null,
      childSessionKey: childKey || null,
      label,
      startedAt: isoFromMs(Math.trunc(startedAt)),
      ageHours,
      endedAt: isoFromMs(now),
    };

    if (!args.dryRun) {
      (run as any).endedAt = now;
      (run as any).endedReason = "reaped_stale";
      (run as any).status = "failed";
      const outcome = (run as any).outcome && typeof (run as any).outcome === "object" ? (run as any).outcome : {};
      outcome.status = "failed";
      (run as any).outcome = outcome;
      (runs as any)[runKey] = run;
      changed = true;

      const metadata = {
        run_key: runKey,
        run_id: runId || null,
        child_session_key: childKey || null,
        label,
        started_at: entry.startedAt,
        ended_at: entry.endedAt,
        age_hours: ageHours,
        reason: "reaped_stale",
      };

      const [eventOk, eventErr] = logReapedEvent(psqlBin, metadata, `Sub-agent run reaped: ${label || childKey || runId || runKey}`);
      entry.eventLogged = Boolean(eventOk);
      if (eventOk) output.summary.eventsLogged += 1;
      else if (eventErr) {
        output.summary.errors += 1;
        output.errors.push({ runKey, error: `event_log_failed: ${eventErr}` });
      }

      const [taskOk, taskErr, taskCount] = resetTasks(psqlBin, runId, label, childKey, outcomeText);
      entry.tasksReset = taskCount;
      if (taskOk) output.summary.tasksReset += taskCount;
      else {
        output.summary.errors += 1;
        output.errors.push({ runKey, error: `task_reset_failed: ${taskErr}` });
      }
    } else {
      entry.eventLogged = false;
      entry.tasksReset = 0;
    }

    output.summary.reapedRuns += 1;
    output.reaped.push(entry);
  }

  if (changed && !args.dryRun) saveJson(RUN_STORE_PATH, payload);

  if (args.emitJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    const summary = output.summary;
    console.log(
      `reaper: scanned=${summary.runsScanned} stale=${summary.staleCandidates} reaped=${summary.reapedRuns} ` +
        `tasks_reset=${summary.tasksReset} events=${summary.eventsLogged} errors=${summary.errors}`
    );
  }

  process.exit(output.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
