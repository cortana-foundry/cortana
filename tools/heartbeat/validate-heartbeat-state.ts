#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { writeJsonFileAtomic } from "../lib/json-file.js";
import { withPostgresPath } from "../lib/db.js";
import { PSQL_BIN } from "../lib/paths.js";

type LastCheck = { lastChecked: number };
type State = {
  version: number;
  lastChecks: Record<string, LastCheck>;
  lastRemediationAt: number;
  subagentWatchdog: { lastRun: number; lastLogged: Record<string, number> };
  lastSnapshotAt?: number;
};

const requiredChecks = [
  "email", "calendar", "watchlist", "tasks", "portfolio", "marketIntel",
  "techNews", "weather", "fitness", "apiBudget", "mission", "cronDelivery",
];

function parseTs(value: unknown, allowZero = false): number {
  if (value == null) throw new Error("timestamp missing");
  if (typeof value === "boolean") throw new Error("invalid bool timestamp");
  if (typeof value === "number") {
    let n = Math.trunc(value);
    if (n === 0 && allowZero) return 0;
    if (n < 1_000_000_000_000) {
      if (n < 1_000_000_000) throw new Error("numeric timestamp too small");
      n *= 1000;
    }
    return n;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) throw new Error("empty timestamp string");
    if (/^\d+$/.test(s)) return parseTs(Number(s));
    const ms = Date.parse(s.replace("Z", "+00:00"));
    if (Number.isNaN(ms)) throw new Error("invalid iso timestamp");
    return ms;
  }
  throw new Error(`unsupported timestamp type: ${typeof value}`);
}

function validate(raw: unknown, nowMs: number, maxStaleMs: number): State {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("state root must be object");
  const root = raw as Record<string, unknown>;
  const checksRaw = root.lastChecks;
  if (!checksRaw || typeof checksRaw !== "object" || Array.isArray(checksRaw)) throw new Error("lastChecks must be object");

  const normalizedChecks: Record<string, LastCheck> = {};
  for (const key of requiredChecks) {
    if (!(key in (checksRaw as Record<string, unknown>))) throw new Error(`missing required check: ${key}`);
    const val = (checksRaw as Record<string, unknown>)[key];
    const tsSrc = val && typeof val === "object" && !Array.isArray(val) ? (val as any).lastChecked : val;
    const ts = parseTs(tsSrc);
    const age = nowMs - ts;
    if (ts > nowMs + 5 * 60 * 1000) throw new Error(`${key} timestamp in future`);
    if (age > maxStaleMs) throw new Error(`${key} timestamp stale`);
    normalizedChecks[key] = { lastChecked: ts };
  }

  const sub = (root.subagentWatchdog as any) || { lastRun: nowMs, lastLogged: {} };
  if (!sub || typeof sub !== "object" || Array.isArray(sub)) throw new Error("subagentWatchdog must be object");
  const lastLoggedRaw = sub.lastLogged ?? {};
  if (!lastLoggedRaw || typeof lastLoggedRaw !== "object" || Array.isArray(lastLoggedRaw)) throw new Error("subagentWatchdog.lastLogged must be object");

  const out: State = {
    version: 2,
    lastChecks: normalizedChecks,
    lastRemediationAt: parseTs(root.lastRemediationAt ?? nowMs, true),
    subagentWatchdog: {
      lastRun: parseTs(sub.lastRun ?? nowMs, true),
      lastLogged: Object.fromEntries(Object.entries(lastLoggedRaw).map(([k, v]) => [String(k), parseTs(v, true)])),
    },
  };

  if ("lastSnapshotAt" in root) {
    try { out.lastSnapshotAt = parseTs(root.lastSnapshotAt); } catch {}
  }
  return out;
}

function defaultState(nowMs: number): State {
  return {
    version: 2,
    lastChecks: Object.fromEntries(requiredChecks.map((k) => [k, { lastChecked: nowMs }])),
    lastRemediationAt: nowMs,
    subagentWatchdog: { lastRun: nowMs, lastLogged: {} },
  };
}

function rotateBackups(stateFile: string): void {
  const b1 = `${stateFile}.bak.1`;
  const b2 = `${stateFile}.bak.2`;
  const b3 = `${stateFile}.bak.3`;
  if (fs.existsSync(b2)) fs.copyFileSync(b2, b3);
  if (fs.existsSync(b1)) fs.copyFileSync(b1, b2);
  fs.copyFileSync(stateFile, b1);
}

async function main(): Promise<void> {
  const stateFile = process.env.HEARTBEAT_STATE_FILE || path.join(os.homedir(), "clawd/memory/heartbeat-state.json");
  const dbName = process.env.DB_NAME || "cortana";
  const snapshotIntervalSec = Number(process.env.SNAPSHOT_INTERVAL_SEC || "21600");
  const maxStaleMs = 48 * 60 * 60 * 1000;
  const nowMs = Date.now();

  const result: Record<string, unknown> = { ok: true, action: "validated", restoredFrom: null, usedDefault: false };
  let normalized: State | null = null;
  let invalidReason: string | null = null;

  if (fs.existsSync(stateFile)) {
    try {
      normalized = validate(JSON.parse(fs.readFileSync(stateFile, "utf8")), nowMs, maxStaleMs);
    } catch (e) {
      invalidReason = e instanceof Error ? e.message : String(e);
    }
  }

  if (!normalized) {
    for (const i of [1, 2, 3] as const) {
      const candidate = `${stateFile}.bak.${i}`;
      if (!fs.existsSync(candidate)) continue;
      try {
        normalized = validate(JSON.parse(fs.readFileSync(candidate, "utf8")), nowMs, maxStaleMs);
        result.action = "restored_from_backup";
        result.restoredFrom = candidate;
        break;
      } catch {}
    }
  }

  if (!normalized) {
    normalized = defaultState(nowMs);
    result.action = "reinitialized_default";
    result.usedDefault = true;
  }

  if (invalidReason) result.invalidReason = invalidReason;

  writeJsonFileAtomic(stateFile, normalized, 2);
  rotateBackups(stateFile);

  const ages = Object.values(normalized.lastChecks).map((v) => nowMs - v.lastChecked);
  result.summary = {
    version: normalized.version,
    checkCount: Object.keys(normalized.lastChecks).length,
    oldestAgeMs: ages.length ? Math.max(...ages) : 0,
    newestAgeMs: ages.length ? Math.min(...ages) : 0,
  };
  result.statePath = stateFile;

  try {
    fs.accessSync(PSQL_BIN, fs.constants.X_OK);
    const env = withPostgresPath({ ...process.env, PGHOST: process.env.PGHOST || "localhost", PGUSER: process.env.PGUSER || process.env.USER });
    const lastAge = spawnSync(PSQL_BIN, [dbName, "-At", "-c", "SELECT COALESCE(EXTRACT(EPOCH FROM (NOW() - MAX(timestamp))), 999999999)::bigint FROM cortana_events WHERE event_type='heartbeat_state_snapshot';"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
    const lastAgeSec = (lastAge.stdout || "999999999").trim();
    if (/^\d+$/.test(lastAgeSec) && Number(lastAgeSec) >= snapshotIntervalSec) {
      const metaSql = JSON.stringify(result).replace(/'/g, "''");
      spawnSync(PSQL_BIN, [dbName, "-c", `INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('heartbeat_state_snapshot','heartbeat-validator','info','Heartbeat state shadow snapshot','${metaSql}'::jsonb);`], {
        encoding: "utf8",
        stdio: ["ignore", "ignore", "ignore"],
        env,
      });
    }
  } catch {}

  console.log(JSON.stringify(result));
}

main();
