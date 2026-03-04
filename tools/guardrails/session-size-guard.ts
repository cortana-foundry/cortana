#!/usr/bin/env npx tsx

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export type Severity = "warning" | "alert";

export type SessionSizeRecord = {
  agent: string;
  sessionFile: string;
  sizeBytes: number;
  sizeKb: number;
  severity: Severity;
};

export type GuardConfig = {
  warningThresholdKb: number;
  alertThresholdKb: number;
  cleanup: boolean;
};

const DEFAULT_WARNING_THRESHOLD_KB = 1024;
const DEFAULT_ALERT_THRESHOLD_KB = 2048;
const PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql";
const DB_NAME = "cortana";

function parseThreshold(envValue: string | undefined, fallback: number): number {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(argv: string[] = process.argv.slice(2)): GuardConfig {
  const warningThresholdKb = parseThreshold(process.env.WARNING_THRESHOLD_KB, DEFAULT_WARNING_THRESHOLD_KB);
  const alertThresholdKb = parseThreshold(process.env.ALERT_THRESHOLD_KB, DEFAULT_ALERT_THRESHOLD_KB);

  return {
    warningThresholdKb,
    alertThresholdKb,
    cleanup: argv.includes("--cleanup"),
  };
}

export function getSessionFiles(rootDir = join(homedir(), ".openclaw", "agents")): string[] {
  try {
    const agentDirs = readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    const files: string[] = [];

    for (const agentDir of agentDirs) {
      const sessionsDir = join(rootDir, agentDir.name, "sessions");
      try {
        const entries = readdirSync(sessionsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!entry.name.endsWith(".jsonl")) continue;
          files.push(join(sessionsDir, entry.name));
        }
      } catch {
        // Ignore missing/non-readable sessions dir for resilience.
      }
    }

    return files;
  } catch {
    return [];
  }
}

export function evaluateFiles(
  files: string[],
  thresholds: Pick<GuardConfig, "warningThresholdKb" | "alertThresholdKb">,
): SessionSizeRecord[] {
  const warningBytes = thresholds.warningThresholdKb * 1024;
  const alertBytes = thresholds.alertThresholdKb * 1024;

  const records: SessionSizeRecord[] = [];

  for (const file of files) {
    let sizeBytes = 0;
    try {
      sizeBytes = statSync(file).size;
    } catch {
      continue;
    }

    if (sizeBytes < warningBytes) continue;

    const severity: Severity = sizeBytes >= alertBytes ? "alert" : "warning";

    records.push({
      agent: basename(dirname(dirname(file))),
      sessionFile: file,
      sizeBytes,
      sizeKb: Number((sizeBytes / 1024).toFixed(2)),
      severity,
    });
  }

  return records.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function logThresholdCrossing(records: SessionSizeRecord[]): void {
  if (records.length === 0) return;

  const hasAlert = records.some((r) => r.severity === "alert");
  const severity = hasAlert ? "error" : "warning";
  const message = hasAlert
    ? `Session size alert: ${records.length} oversized session file(s) detected.`
    : `Session size warning: ${records.length} oversized session file(s) detected.`;

  const metadata = JSON.stringify({
    count: records.length,
    oversizedSessions: records,
  });

  const query = `
    INSERT INTO cortana_events (event_type, source, severity, message, metadata)
    VALUES (
      'session_size_warning',
      'session-size-guard',
      ${sqlLiteral(severity)},
      ${sqlLiteral(message)},
      '${metadata.replace(/'/g, "''")}'::jsonb
    );
  `;

  try {
    execSync(`${PSQL_BIN} -X -d ${DB_NAME} -v ON_ERROR_STOP=1 -c ${sqlLiteral(query)}`, {
      env: {
        ...process.env,
        PATH: `/opt/homebrew/opt/postgresql@17/bin:${process.env.PATH ?? ""}`,
      },
      stdio: "ignore",
    });
  } catch {
    // Do not fail guardrail if DB logging fails.
  }
}

export function runCleanupIfNeeded(records: SessionSizeRecord[], cleanup: boolean): void {
  if (!cleanup) return;
  const hasAlert = records.some((r) => r.severity === "alert");
  if (!hasAlert) return;

  try {
    execSync("openclaw sessions cleanup --all-agents --enforce", { stdio: "ignore" });
  } catch {
    // Keep script non-fatal even if cleanup command fails.
  }
}

export function buildSummary(records: SessionSizeRecord[], config: GuardConfig) {
  return {
    source: "session-size-guard",
    warningThresholdKb: config.warningThresholdKb,
    alertThresholdKb: config.alertThresholdKb,
    totalOversized: records.length,
    sessions: records,
  };
}

export function run(argv: string[] = process.argv.slice(2), rootDir?: string): number {
  const config = getConfig(argv);
  const files = getSessionFiles(rootDir);
  const oversized = evaluateFiles(files, config);

  if (oversized.length === 0) {
    return 0;
  }

  logThresholdCrossing(oversized);
  runCleanupIfNeeded(oversized, config.cleanup);

  process.stdout.write(`${JSON.stringify(buildSummary(oversized, config))}\n`);
  return 0;
}

const entryArg = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryArg) {
  const code = run();
  process.exit(code);
}
