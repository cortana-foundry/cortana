#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";

const PSQL_BIN = process.env.PSQL_BIN || "/opt/homebrew/opt/postgresql@17/bin/psql";
const DB_NAME = process.env.DB_NAME || "cortana";
const MAX_AGE_MINUTES = Number(process.env.SAE_MAX_AGE_MINUTES || 90);
const MAX_ERROR_RATIO = Number(process.env.SAE_MAX_ERROR_RATIO || 0.3);
const MIN_DOMAIN_COVERAGE = Number(process.env.SAE_MIN_DOMAIN_COVERAGE || 0.7);
const DEFAULT_EXPECTED_DOMAINS = ["calendar", "email", "weather", "health", "finance", "tasks", "patterns", "watchlist", "system"];

export type GateResult = {
  ok: boolean;
  shouldProceed: boolean;
  reason: string;
  run: {
    run_id: string;
    status: string;
    completed_at: string | null;
    expected_domains: string[] | null;
    actual_domains: string[] | null;
    total_keys: number | null;
    error_count: number;
  } | null;
  checks: {
    fresh: boolean;
    errorRatioOk: boolean;
    coverageOk: boolean;
  };
  metrics: {
    ageMinutes: number | null;
    errorRatio: number | null;
    domainCoverage: number | null;
    expectedDomainCount: number;
    actualDomainCount: number;
  };
};

function withPostgresPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: `/opt/homebrew/opt/postgresql@17/bin:${env.PATH ?? ""}`,
  };
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

function loadLatestCompletedRun() {
  const sql = `
    SELECT COALESCE(row_to_json(t), '{}'::json)::text
    FROM (
      SELECT run_id, status, completed_at, expected_domains, actual_domains, total_keys, error_count
      FROM cortana_sitrep_runs
      WHERE status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    ) t;
  `;
  const out = runPsql(sql);
  if (!out || out === "{}") return null;
  return JSON.parse(out) as GateResult["run"];
}

export function evaluateFreshnessGate(now = new Date()): GateResult {
  const run = loadLatestCompletedRun();

  if (!run) {
    return {
      ok: false,
      shouldProceed: false,
      reason: "no_completed_runs",
      run: null,
      checks: { fresh: false, errorRatioOk: false, coverageOk: false },
      metrics: {
        ageMinutes: null,
        errorRatio: null,
        domainCoverage: null,
        expectedDomainCount: 0,
        actualDomainCount: 0,
      },
    };
  }

  const completedAt = run.completed_at ? new Date(run.completed_at) : null;
  const ageMinutes = completedAt ? (now.getTime() - completedAt.getTime()) / 60000 : Number.POSITIVE_INFINITY;
  const totalKeys = run.total_keys ?? 0;
  const errorCount = run.error_count ?? 0;
  const errorRatio = totalKeys > 0 ? errorCount / totalKeys : 1;

  const expectedDomains = (run.expected_domains && run.expected_domains.length > 0
    ? run.expected_domains
    : DEFAULT_EXPECTED_DOMAINS) as string[];
  const expectedSet = new Set(expectedDomains);
  const actualSet = new Set(run.actual_domains || []);
  const covered = [...expectedSet].filter((d) => actualSet.has(d)).length;
  const domainCoverage = expectedSet.size > 0 ? covered / expectedSet.size : 0;

  const checks = {
    fresh: ageMinutes <= MAX_AGE_MINUTES,
    errorRatioOk: errorRatio < MAX_ERROR_RATIO,
    coverageOk: domainCoverage >= MIN_DOMAIN_COVERAGE,
  };

  const shouldProceed = checks.fresh && checks.errorRatioOk && checks.coverageOk;

  return {
    ok: shouldProceed,
    shouldProceed,
    reason: shouldProceed
      ? "ok"
      : !checks.fresh
        ? "stale_run"
        : !checks.errorRatioOk
          ? "error_ratio_high"
          : "coverage_low",
    run,
    checks,
    metrics: {
      ageMinutes: Number.isFinite(ageMinutes) ? Number(ageMinutes.toFixed(2)) : null,
      errorRatio: Number.isFinite(errorRatio) ? Number(errorRatio.toFixed(4)) : null,
      domainCoverage: Number(domainCoverage.toFixed(4)),
      expectedDomainCount: expectedSet.size,
      actualDomainCount: actualSet.size,
    },
  };
}

export function cli(): number {
  try {
    const result = evaluateFreshnessGate();
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.shouldProceed ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, shouldProceed: false, reason: "gate_error", error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(cli());
}
