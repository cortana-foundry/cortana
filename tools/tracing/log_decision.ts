#!/usr/bin/env npx tsx

import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { PSQL_BIN, POSTGRES_PATH } from "../lib/paths.js";

function parseJsonArg(value: string | null, field: string): Record<string, any> {
  if (!value) return {};
  let parsed: any;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON for ${field}: ${msg}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON object`);
  }
  return parsed;
}

type Args = {
  traceId: string;
  eventId: number | null;
  taskId: number | null;
  runId: string | null;
  trigger: string | null;
  actionType: string | null;
  actionName: string | null;
  reasoning: string | null;
  confidence: number | null;
  outcome: string;
  dataInputs: string | null;
  metadata: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    traceId: randomUUID(),
    eventId: null,
    taskId: null,
    runId: null,
    trigger: null,
    actionType: null,
    actionName: null,
    reasoning: null,
    confidence: null,
    outcome: "unknown",
    dataInputs: null,
    metadata: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--trace-id":
        args.traceId = argv[i + 1] ?? args.traceId;
        i += 1;
        break;
      case "--event-id":
        args.eventId = Number(argv[i + 1]);
        i += 1;
        break;
      case "--task-id":
        args.taskId = Number(argv[i + 1]);
        i += 1;
        break;
      case "--run-id":
        args.runId = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--trigger":
        args.trigger = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--action-type":
        args.actionType = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--action-name":
        args.actionName = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--reasoning":
        args.reasoning = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--confidence":
        args.confidence = Number(argv[i + 1]);
        i += 1;
        break;
      case "--outcome":
        args.outcome = argv[i + 1] ?? args.outcome;
        i += 1;
        break;
      case "--data-inputs":
        args.dataInputs = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--metadata":
        args.metadata = argv[i + 1] ?? null;
        i += 1;
        break;
      default:
        break;
    }
  }

  return args;
}

function run(): number {
  const args = parseArgs(process.argv.slice(2));

  if (!args.trigger || !args.actionType || !args.actionName) {
    console.error(
      "usage: log_decision.ts --trigger <trigger> --action-type <type> --action-name <name> [options]"
    );
    return 2;
  }

  if (args.confidence != null && (args.confidence < 0 || args.confidence > 1)) {
    console.error("confidence must be between 0 and 1");
    return 1;
  }

  let dataInputs: string;
  let metadata: string;
  try {
    dataInputs = JSON.stringify(parseJsonArg(args.dataInputs, "--data-inputs"));
    metadata = JSON.stringify(parseJsonArg(args.metadata, "--metadata"));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const env = {
    ...process.env,
    PATH: `${POSTGRES_PATH}:${process.env.PATH ?? ""}`,
  };
  const db = process.env.CORTANA_DATABASE_URL || process.env.DATABASE_URL || "cortana";

  const q = (value: string): string => `'${String(value).replace(/'/g, "''")}'`;
  const sql = `
    INSERT INTO cortana_decision_traces (
      trace_id,event_id,task_id,run_id,trigger_type,action_type,action_name,
      reasoning,confidence,outcome,data_inputs,metadata
    ) VALUES (
      ${q(args.traceId)}, NULLIF(${q(args.eventId == null ? "" : String(args.eventId))},'')::bigint,
      NULLIF(${q(args.taskId == null ? "" : String(args.taskId))},'')::bigint,
      NULLIF(${q(args.runId == null ? "" : args.runId)},''), ${q(args.trigger)}, ${q(args.actionType)}, ${q(args.actionName)},
      NULLIF(${q(args.reasoning == null ? "" : args.reasoning)},''), NULLIF(${q(args.confidence == null ? "" : String(args.confidence))},'')::numeric,
      ${q(args.outcome)},
      ${q(dataInputs)}::jsonb, ${q(metadata)}::jsonb
    )
    ON CONFLICT (trace_id) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      task_id = EXCLUDED.task_id,
      run_id = EXCLUDED.run_id,
      trigger_type = EXCLUDED.trigger_type,
      action_type = EXCLUDED.action_type,
      action_name = EXCLUDED.action_name,
      reasoning = EXCLUDED.reasoning,
      confidence = EXCLUDED.confidence,
      outcome = EXCLUDED.outcome,
      data_inputs = EXCLUDED.data_inputs,
      metadata = EXCLUDED.metadata;
    `;

  const cmd = [PSQL_BIN, db, "-v", "ON_ERROR_STOP=1", "-c", sql];

  const proc = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env });
  if (proc.status !== 0) {
    const msg = (proc.stderr || proc.stdout || "").trim();
    console.error(`failed to log decision trace: ${msg || "psql failed"}`);
    return 1;
  }

  console.log(JSON.stringify({ ok: true, trace_id: args.traceId }));
  return 0;
}

async function main(): Promise<void> {
  process.exit(run());
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
