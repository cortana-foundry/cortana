#!/usr/bin/env npx tsx

import { runPsql } from "../lib/db.js";

const DEFAULT_MONTHLY_BUDGET = 200.0;

const MODEL_RATES_PER_1K: Record<string, [number, number]> = {
  "gpt-5": [0.01, 0.03],
  "gpt-5.3-codex": [0.01, 0.03],
  "gpt-5-codex": [0.01, 0.03],
  codex: [0.01, 0.03],
  "claude-opus": [0.015, 0.075],
  "claude-opus-4": [0.015, 0.075],
  "claude-opus-4-6": [0.015, 0.075],
  "claude-sonnet": [0.003, 0.015],
  "gpt-4o": [0.005, 0.015],
  "gpt-4.1": [0.005, 0.015],
  "gpt-4.1-mini": [0.0006, 0.0024],
};

const FALLBACK_RATE_PER_1K: [number, number] = [0.01, 0.03];

type UsageEvent = {
  agent_role: string;
  task_id: number | null;
  trace_id: string | null;
  tokens_in: number;
  tokens_out: number;
  model: string;
  cost_estimate?: number | null;
  metadata?: Record<string, any> | null;
};

function dbTarget(): string {
  return process.env.CORTANA_DATABASE_URL || process.env.DATABASE_URL || "cortana";
}

function runPsqlRaw(sql: string, csv = false): string {
  const args = csv ? ["--csv"] : [];
  const proc = runPsql(sql, { db: dbTarget(), args, stdio: "pipe" });
  if (proc.status !== 0) {
    const msg = (proc.stderr || "").trim() || (proc.stdout || "").trim() || "psql failed";
    throw new Error(msg);
  }
  return (proc.stdout || "").trim();
}

function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNullableStr(value: string | null | undefined): string {
  if (!value) return "NULL";
  return sqlStr(value);
}

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const modelLower = model.toLowerCase();
  let [inRate, outRate] = FALLBACK_RATE_PER_1K;
  for (const [key, rates] of Object.entries(MODEL_RATES_PER_1K)) {
    if (modelLower.includes(key)) {
      [inRate, outRate] = rates;
      break;
    }
  }
  return Math.round((((tokensIn / 1000.0) * inRate + (tokensOut / 1000.0) * outRate) * 1e6)) / 1e6;
}

function logUsage(event: UsageEvent): Record<string, any> {
  const metadata = event.metadata ?? {};
  const costEstimate =
    event.cost_estimate === null || event.cost_estimate === undefined
      ? estimateCost(event.model, event.tokens_in, event.tokens_out)
      : event.cost_estimate;

  const taskSql = event.task_id === null || event.task_id === undefined ? "NULL" : String(Number(event.task_id));

  const sql = `
    INSERT INTO cortana_token_ledger (
      agent_role, task_id, trace_id, model, tokens_in, tokens_out, estimated_cost, metadata
    ) VALUES (
      ${sqlStr(event.agent_role)}, ${taskSql}, ${sqlNullableStr(event.trace_id)}, ${sqlStr(event.model)},
      ${Number(event.tokens_in)}, ${Number(event.tokens_out)}, ${Number(costEstimate)}::numeric(12,6),
      ${sqlStr(JSON.stringify(metadata))}::jsonb
    )
    RETURNING id, timestamp, estimated_cost;
    `;

  const output = runPsqlRaw(sql, true);
  const lines = output.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("Failed to parse insert output");
  const headers = lines[0].split(",").map((h) => h.trim());
  const values = lines[1].split(",").map((v) => v.trim());
  const row: Record<string, string> = {};
  headers.forEach((h, idx) => {
    row[h] = values[idx] ?? "";
  });
  return row;
}

function summary(period: string): Record<string, any> {
  const windows: Record<string, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
  if (!windows[period]) {
    throw new Error("period must be one of: 24h, 7d, 30d");
  }
  const interval = windows[period];

  const byAgentSql = `
    SELECT agent_role,
           COUNT(*) AS calls,
           SUM(tokens_in) AS tokens_in,
           SUM(tokens_out) AS tokens_out,
           ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '${interval}'
    GROUP BY agent_role
    ORDER BY spend_usd DESC;
    `;
  const byModelSql = `
    SELECT model,
           COUNT(*) AS calls,
           SUM(tokens_in) AS tokens_in,
           SUM(tokens_out) AS tokens_out,
           ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '${interval}'
    GROUP BY model
    ORDER BY spend_usd DESC;
    `;
  const byTaskTypeSql = `
    SELECT
      COALESCE(metadata->>'task_type', CASE WHEN task_id IS NULL THEN 'session' ELSE 'task' END) AS task_type,
      COUNT(*) AS calls,
      ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd,
      SUM(tokens_in + tokens_out) AS total_tokens
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '${interval}'
    GROUP BY 1
    ORDER BY spend_usd DESC;
    `;
  const cacheSql = `
    SELECT
      COUNT(*) FILTER (WHERE (metadata->>'prompt_cache_hit')::boolean IS TRUE) AS cache_hits,
      COUNT(*) FILTER (WHERE metadata ? 'prompt_cache_hit') AS cache_observed,
      COALESCE(SUM((metadata->>'prompt_cache_read_tokens')::bigint),0) AS cache_read_tokens,
      COALESCE(SUM((metadata->>'prompt_cache_write_tokens')::bigint),0) AS cache_write_tokens
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '${interval}';
    `;

  return {
    period,
    by_agent: runPsqlRaw(byAgentSql, true),
    by_model: runPsqlRaw(byModelSql, true),
    by_task_type: runPsqlRaw(byTaskTypeSql, true),
    prompt_cache: runPsqlRaw(cacheSql, true),
  };
}

function topSpenders(limit: number): string {
  const sql = `
    SELECT id, timestamp, agent_role, task_id, trace_id, model,
           (tokens_in + tokens_out) AS total_tokens,
           ROUND(estimated_cost::numeric, 6) AS estimated_cost,
           COALESCE(metadata->>'task_type','') AS task_type
    FROM cortana_token_ledger
    ORDER BY estimated_cost DESC, timestamp DESC
    LIMIT ${Number(limit)};
    `;
  return runPsqlRaw(sql, true);
}

function budgetCheck(monthlyBudget: number): Record<string, any> {
  const sql = `
    WITH month_data AS (
      SELECT DATE_TRUNC('month', NOW()) AS month_start,
             NOW() AS as_of,
             EXTRACT(DAY FROM (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day'))::numeric AS days_in_month,
             EXTRACT(EPOCH FROM (NOW() - DATE_TRUNC('month', NOW()))) / 86400.0 AS elapsed_days,
             COALESCE(SUM(estimated_cost), 0)::numeric AS spend_to_date
      FROM cortana_token_ledger
      WHERE timestamp >= DATE_TRUNC('month', NOW())
    )
    SELECT month_start,
           as_of,
           spend_to_date,
           ROUND(CASE WHEN elapsed_days > 0 THEN spend_to_date / elapsed_days ELSE 0 END, 4) AS burn_rate_per_day,
           ROUND(CASE WHEN elapsed_days > 0 THEN (spend_to_date / elapsed_days) * days_in_month ELSE 0 END, 2) AS projected_monthly_spend,
           ROUND((spend_to_date / ${Number(monthlyBudget)}) * 100.0, 2) AS pct_of_budget
    FROM month_data;
    `;
  return {
    budget_usd: monthlyBudget,
    snapshot: runPsqlRaw(sql, true),
  };
}

function parseMetadata(raw: string | null): Record<string, any> {
  if (!raw) return {};
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON for --metadata: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("--metadata must be a JSON object");
  }
  return payload;
}

function parseArgs(argv: string[]) {
  const command = argv[0];
  if (!command) throw new Error("command required");
  const args = argv.slice(1);
  const get = (name: string): string | null => {
    const idx = args.indexOf(name);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  return { command, args, get };
}

async function main(): Promise<number> {
  try {
    const { command, args, get } = parseArgs(process.argv.slice(2));

    if (command === "log-usage") {
      const agentRole = get("--agent-role");
      const tokensIn = get("--tokens-in");
      const tokensOut = get("--tokens-out");
      const model = get("--model");
      if (!agentRole || !tokensIn || !tokensOut || !model) throw new Error("missing required arguments");
      const taskIdRaw = get("--task-id");
      const traceId = get("--trace-id");
      const costEstimateRaw = get("--cost-estimate");
      const metadataRaw = get("--metadata");

      const metadata = parseMetadata(metadataRaw);
      const row = logUsage({
        agent_role: agentRole,
        task_id: taskIdRaw ? Number.parseInt(taskIdRaw, 10) : null,
        trace_id: traceId,
        tokens_in: Number.parseInt(tokensIn, 10),
        tokens_out: Number.parseInt(tokensOut, 10),
        model,
        cost_estimate: costEstimateRaw ? Number.parseFloat(costEstimateRaw) : null,
        metadata,
      });

      console.log(
        JSON.stringify({ ok: true, event: row, logged_at: new Date().toISOString() }),
      );
      return 0;
    }

    if (command === "summary") {
      const period = get("--period");
      if (!period) throw new Error("period must be one of: 24h, 7d, 30d");
      console.log(JSON.stringify(summary(period), null, 2));
      return 0;
    }

    if (command === "top-spenders") {
      const limitRaw = get("--limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
      console.log(topSpenders(limit));
      return 0;
    }

    if (command === "budget-check") {
      const budgetRaw = get("--budget");
      const budget = budgetRaw ? Number.parseFloat(budgetRaw) : DEFAULT_MONTHLY_BUDGET;
      console.log(JSON.stringify(budgetCheck(budget), null, 2));
      return 0;
    }

    console.error("Unknown command");
    return 1;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
