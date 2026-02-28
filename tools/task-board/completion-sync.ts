#!/usr/bin/env npx tsx
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { withPostgresPath } from "../lib/db.js";
import { PSQL_BIN } from "../lib/paths.js";

const DB_NAME = process.env.CORTANA_DB ?? "cortana";
const SOURCE = "task-board-completion-sync";

const sqlEscape = (s: string) => s.replace(/'/g, "''");
const psql = (sql: string) => spawnSync(PSQL_BIN, [DB_NAME, "-q", "-X", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: withPostgresPath(process.env) });
const psqlOut = (sql: string) => (psql(sql).stdout ?? "").trim();

function generateOperationId() {
  return process.env.CORTANA_OPERATION_ID ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function checkIdempotency(operationId: string) {
  const op = sqlEscape(operationId);
  const c = psqlOut(`SELECT COUNT(*)::int FROM cortana_events WHERE event_type='idempotent_operation' AND COALESCE(metadata->>'operation_id','')='${op}' AND COALESCE(metadata->>'status','') IN ('completed','success','done');`).replace(/\s/g, "") || "0";
  return Number(c) > 0;
}
function logIdempotency(operationId: string, operationType: string, status: string, metadata = "{}") {
  const op = sqlEscape(operationId), typ = sqlEscape(operationType), st = sqlEscape(status), meta = sqlEscape(metadata);
  psqlOut(`INSERT INTO cortana_events (event_type, source, severity, message, metadata)
  VALUES ('idempotent_operation','${SOURCE}',CASE WHEN '${st}' IN ('failed','error') THEN 'error' WHEN '${st}' IN ('skipped','duplicate') THEN 'warning' ELSE 'info' END,
  'Idempotent operation ${typ} -> ${st}',COALESCE('${meta}'::jsonb,'{}'::jsonb)||jsonb_build_object('operation_id','${op}','operation_type','${typ}','status','${st}','logged_at',NOW()::text));`);
}
function emitRunEvent(runId: string, taskId: number, eventType: string, metadata: any) {
  const script = "/Users/hd/openclaw/tools/task-board/emit-run-event.sh";
  if (!fs.existsSync(script)) return;
  spawnSync(script, [runId, String(taskId), eventType, SOURCE, JSON.stringify(metadata)], { stdio: "ignore", env: withPostgresPath(process.env) });
}

function main() {
  if (!fs.existsSync(PSQL_BIN)) { console.log('{"ok":false,"error":"psql_not_found"}'); process.exit(1); }
  if (spawnSync("bash", ["-lc", "command -v openclaw"], { stdio: "ignore" }).status !== 0) { console.log('{"ok":false,"error":"openclaw_not_found"}'); process.exit(1); }
  if (spawnSync("bash", ["-lc", "command -v jq"], { stdio: "ignore" }).status !== 0) { console.log('{"ok":false,"error":"jq_not_found"}'); process.exit(1); }

  const operationId = generateOperationId(); const operationType = "completion_sync_pass";
  if (checkIdempotency(operationId)) { logIdempotency(operationId, operationType, "skipped", '{"reason":"already_completed"}'); console.log(JSON.stringify({ ok: true, skipped: true, reason: "idempotent_operation_already_completed" })); process.exit(0); }
  logIdempotency(operationId, operationType, "started", "{}");

  const sess = spawnSync("openclaw", ["sessions", "--json", "--active", "1440", "--all-agents"], { encoding: "utf8" });
  const sessionsJson = sess.status === 0 ? (sess.stdout || '{"sessions":[]}') : '{"sessions":[]}';
  let sessions: any[] = [];
  try { sessions = (JSON.parse(sessionsJson).sessions ?? []).filter((s: any) => String(s.key ?? "").includes(":subagent:")); } catch {}

  const updates: any[] = [];
  for (const row of sessions) {
    const key = String(row.key ?? ""), label = String(row.label ?? ""), runId = String(row.run_id ?? row.runId ?? row.sessionId ?? "");
    const statusRaw = String(row.status ?? row.lastStatus ?? "unknown").toLowerCase();
    let outcomeStatus = "", lifecycle = "";
    if (/^(ok|done|completed|success)$/.test(statusRaw)) { outcomeStatus = "completed"; lifecycle = "completed"; }
    else if (/^(timeout|timed_out)$/.test(statusRaw)) { outcomeStatus = "failed"; lifecycle = "timeout"; }
    else if (/^(killed|kill|terminated)$/.test(statusRaw)) { outcomeStatus = "failed"; lifecycle = "killed"; }
    else if (/^(failed|error|aborted|cancelled)$/.test(statusRaw) || row.abortedLastRun === true) { outcomeStatus = "failed"; lifecycle = "failed"; }
    else continue;

    const rs = sqlEscape(runId), ls = sqlEscape(label), ks = sqlEscape(key);
    const taskIdStr = psqlOut(`SELECT id FROM cortana_tasks WHERE status='in_progress' AND ((NULLIF('${rs}','') IS NOT NULL AND run_id='${rs}') OR (run_id IS NULL AND (assigned_to='${ls}' OR assigned_to='${ks}' OR COALESCE(metadata->>'subagent_label','')='${ls}' OR COALESCE(metadata->>'subagent_session_key','')='${ks}'))) ORDER BY CASE WHEN NULLIF('${rs}','') IS NOT NULL AND run_id='${rs}' THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, created_at DESC LIMIT 1;`).replace(/\s/g, "");
    if (!taskIdStr) continue;
    const taskId = Number(taskIdStr);
    const outcome = sqlEscape(`Auto-synced from sub-agent ${label || key} (${statusRaw})`);

    psqlOut("BEGIN;");
    psqlOut(`UPDATE cortana_tasks SET status='${outcomeStatus === "completed" ? "completed" : "failed"}', ${outcomeStatus === "completed" ? "completed_at=COALESCE(completed_at,NOW())," : ""} outcome='${outcome}', run_id=COALESCE(NULLIF('${rs}',''), run_id), metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('completion_synced_at',NOW()::text,'subagent_status','${statusRaw}','subagent_run_id',NULLIF('${rs}','')) WHERE id=${taskId} AND status='in_progress';`);
    emitRunEvent(runId || `session:${key}`, taskId, lifecycle, { session_key: key, label, raw_run_id: runId || null, status: statusRaw, mapped_outcome: outcomeStatus });
    psqlOut(`INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('task_completion_synced','${SOURCE}','info','Synced task #${taskId} from sub-agent ${sqlEscape(label || key)} -> ${outcomeStatus}', jsonb_build_object('task_id',${taskId},'session_key','${ks}','label','${ls}','run_id',NULLIF('${rs}',''),'status','${statusRaw}','mapped_outcome','${outcomeStatus}','lifecycle_event','${lifecycle}'));`);
    psqlOut("COMMIT;");

    updates.push({ task_id: taskId, label, session_key: key, run_id: runId, status: statusRaw, mapped_outcome: outcomeStatus });
  }

  logIdempotency(operationId, operationType, "completed", JSON.stringify({ synced_count: updates.length }));
  console.log(JSON.stringify({ ok: true, synced_count: updates.length, synced: updates }));
}

main();
