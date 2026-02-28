#!/usr/bin/env npx tsx

import { randomUUID } from "crypto";
import { runPsql, withPostgresPath } from "./lib/db.js";
import { stringifyJson } from "./lib/json-file.js";

const args = process.argv.slice(2);

if (args.length < 4) {
  console.error(
    `Usage: ${process.argv[1] ?? "log-decision.ts"} <trigger_type> <action_type> <action_name> <outcome> [reasoning] [confidence] [event_id] [task_id] [data_inputs_json]`
  );
  process.exit(1);
}

const [
  triggerType,
  actionType,
  actionName,
  outcome,
  reasoningRaw = "",
  confidenceRaw = "",
  eventIdRaw = "",
  taskIdRaw = "",
  dataInputsRaw = "",
] = args;

const traceId = randomUUID().toLowerCase();
const reasoning = reasoningRaw ?? "";
const confidence = confidenceRaw ?? "";
const eventId = eventIdRaw ?? "";
const taskId = taskIdRaw ?? "";
const dataInputs = dataInputsRaw && dataInputsRaw.trim() !== "" ? dataInputsRaw : stringifyJson({});

const sql = `
INSERT INTO cortana_decision_traces (
  trace_id,
  trigger_type,
  action_type,
  action_name,
  outcome,
  reasoning,
  confidence,
  event_id,
  task_id,
  data_inputs,
  metadata,
  completed_at
) VALUES (
  :'trace_id',
  :'trigger_type',
  :'action_type',
  :'action_name',
  :'outcome',
  NULLIF(:'reasoning', ''),
  NULLIF(:'confidence', '')::numeric,
  NULLIF(:'event_id', '')::bigint,
  NULLIF(:'task_id', '')::bigint,
  COALESCE(NULLIF(:'data_inputs', ''), '{}')::jsonb,
  jsonb_build_object('logged_by', 'tools/log-decision.sh'),
  CASE WHEN :'outcome' IN ('success', 'fail', 'skipped') THEN NOW() ELSE NULL END
);
`;

const result = runPsql(sql, {
  db: "cortana",
  args: [
    "-v",
    "ON_ERROR_STOP=1",
    "-v",
    `trace_id=${traceId}`,
    "-v",
    `trigger_type=${triggerType}`,
    "-v",
    `action_type=${actionType}`,
    "-v",
    `action_name=${actionName}`,
    "-v",
    `outcome=${outcome}`,
    "-v",
    `reasoning=${reasoning}`,
    "-v",
    `confidence=${confidence}`,
    "-v",
    `event_id=${eventId}`,
    "-v",
    `task_id=${taskId}`,
    "-v",
    `data_inputs=${dataInputs}`,
  ],
  env: withPostgresPath(process.env),
  stdio: "ignore",
});

if (result.status !== 0) {
  process.exit(result.status);
}

console.log(traceId);
