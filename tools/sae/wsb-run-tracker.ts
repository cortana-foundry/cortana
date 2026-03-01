#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { PSQL_BIN } from "../lib/paths.js";

const DB_NAME = process.env.DB_NAME || "cortana";

type RunStatus = "running" | "completed" | "partial" | "failed";

export type SitrepRun = {
  run_id: string;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  expected_domains: string[] | null;
  actual_domains: string[] | null;
  total_keys: number | null;
  error_count: number;
  metadata: Record<string, unknown> | null;
};

function withPostgresPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `/opt/homebrew/opt/postgresql@17/bin:${env.PATH ?? ""}`,
  };
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return "ARRAY[]::text[]";
  const escaped = values.map((v) => sqlString(v)).join(",");
  return `ARRAY[${escaped}]::text[]`;
}

function runPsql(sql: string): string {
  const proc = spawnSync(PSQL_BIN, [DB_NAME, "-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env: withPostgresPath(process.env),
  });

  if ((proc.status ?? 1) !== 0) {
    throw new Error((proc.stderr || proc.stdout || "psql failed").trim());
  }

  return (proc.stdout || "").trim();
}

export function start(runId: string, expectedDomains: string[]): void {
  const normalizedExpected = expectedDomains.map((d) => d.trim()).filter(Boolean);
  const sql = `
    INSERT INTO cortana_sitrep_runs (run_id, expected_domains, status)
    VALUES (${sqlString(runId)}, ${sqlTextArray(normalizedExpected)}, 'running')
    ON CONFLICT (run_id)
    DO UPDATE SET
      started_at = NOW(),
      completed_at = NULL,
      status = 'running',
      expected_domains = EXCLUDED.expected_domains,
      actual_domains = NULL,
      total_keys = NULL,
      error_count = 0;
  `;
  runPsql(sql);
}

export function complete(runId: string): void {
  const sql = `
    WITH stats AS (
      SELECT
        COALESCE(array_agg(DISTINCT domain ORDER BY domain), ARRAY[]::text[]) AS actual_domains,
        COUNT(*)::int AS total_keys,
        COUNT(*) FILTER (WHERE key = 'error' OR key LIKE 'error_%')::int AS error_count
      FROM cortana_sitrep
      WHERE run_id::text = ${sqlString(runId)}
    )
    UPDATE cortana_sitrep_runs r
    SET
      completed_at = NOW(),
      actual_domains = stats.actual_domains,
      total_keys = stats.total_keys,
      error_count = stats.error_count,
      status = CASE
        WHEN stats.total_keys = 0 THEN 'failed'
        WHEN stats.total_keys > 0 AND (stats.error_count::float / GREATEST(stats.total_keys, 1)) >= 0.30 THEN 'partial'
        WHEN COALESCE(array_length(r.expected_domains, 1), 0) > 0
         AND COALESCE(array_length(stats.actual_domains, 1), 0) < COALESCE(array_length(r.expected_domains, 1), 0)
          THEN 'partial'
        ELSE 'completed'
      END
    FROM stats
    WHERE r.run_id = ${sqlString(runId)};
  `;
  runPsql(sql);
}

export function getLatestCompletedRun(): SitrepRun | null {
  const sql = `
    SELECT COALESCE(row_to_json(t), '{}'::json)::text
    FROM (
      SELECT run_id, started_at, completed_at, status, expected_domains, actual_domains, total_keys, error_count, metadata
      FROM cortana_sitrep_runs
      WHERE status = 'completed'
      ORDER BY completed_at DESC NULLS LAST
      LIMIT 1
    ) t;
  `;
  const out = runPsql(sql);
  if (!out || out === "{}") return null;
  return JSON.parse(out) as SitrepRun;
}

// Backward-compatible aliases.
export const startRun = start;
export const completeRun = complete;

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function usage(): void {
  printJson({
    ok: false,
    error: "usage",
    help: "wsb-run-tracker.ts <start|complete|getLatestCompletedRun> [run_id] [expected_domains_csv]",
  });
}

export function cli(argv = process.argv.slice(2)): number {
  const [command, runId, expectedCsv] = argv;

  try {
    if (command === "start" || command === "startRun") {
      if (!runId) {
        usage();
        return 2;
      }
      const expectedDomains = (expectedCsv || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      start(runId, expectedDomains);
      printJson({ ok: true, action: "start", run_id: runId, expected_domains: expectedDomains });
      return 0;
    }

    if (command === "complete" || command === "completeRun") {
      if (!runId) {
        usage();
        return 2;
      }
      complete(runId);
      printJson({ ok: true, action: "complete", run_id: runId });
      return 0;
    }

    if (command === "getLatestCompletedRun") {
      const run = getLatestCompletedRun();
      printJson({ ok: true, action: "getLatestCompletedRun", run });
      return 0;
    }

    usage();
    return 2;
  } catch (error) {
    printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(cli());
}
