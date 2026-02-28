#!/usr/bin/env npx tsx
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { withPostgresPath } from "../lib/db.js";
import { PSQL_BIN } from "../lib/paths.js";

type Json = Record<string, any>;

const DB = process.env.CORTANA_DB ?? "cortana";
const ROOT = process.env.CORTANA_ROOT ?? "/Users/hd";
const ALLOW_PREFIX_1 = `${ROOT}/Developer/cortana`;
const ALLOW_PREFIX_2 = `${ROOT}/Developer/cortana-external`;
const LOG_DECISION_SCRIPT = "/Users/hd/openclaw/tools/log-decision.sh";
const SOURCE = "task-board-auto-executor";
const EMIT_RUN_EVENT_SCRIPT = "/Users/hd/openclaw/tools/task-board/emit-run-event.sh";
const MAX_FAILURES_PER_HOUR = Number(process.env.AUTO_EXEC_MAX_FAILURES_PER_HOUR ?? "3");
const PAUSE_MINUTES = Number(process.env.AUTO_EXEC_PAUSE_MINUTES ?? "60");
const ALLOW_TASK_TYPES = process.env.AUTO_EXEC_ALLOW_TASK_TYPES ?? "research,analysis,maintenance,monitoring,reporting";

function sqlEscape(v: string): string { return v.replace(/'/g, "''"); }
function runPsql(sql: string): string {
  const r = spawnSync(PSQL_BIN, [DB, "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: withPostgresPath(process.env) });
  return (r.stdout ?? "").trim();
}
function queryOne(sql: string): string { return runPsql(sql).trim(); }
function auditEvent(eventType: string, severity: string, message: string, metadata: string = "{}") {
  const escMsg = sqlEscape(message); const escMeta = sqlEscape(metadata);
  runPsql(`INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('${eventType}', '${SOURCE}', '${severity}', '${escMsg}', '${escMeta}'::jsonb);`);
}
function logTaskDecision(action: string, outcome: string, reasoning: string, confidence = "0.9", taskId = "") {
  if (!fs.existsSync(LOG_DECISION_SCRIPT)) return;
  spawnSync(LOG_DECISION_SCRIPT, ["auto_executor", "task_execution", action, outcome, reasoning, confidence, "", taskId, taskId ? JSON.stringify({ task_id: Number(taskId) }) : "{}"], { stdio: "ignore" });
}
function isTypeAllowed(taskType: string): boolean { return (`,` + ALLOW_TASK_TYPES + `,`).includes(`,${taskType},`); }
function genOperationId(): string { return process.env.CORTANA_OPERATION_ID ?? randomUUID().toLowerCase(); }
function checkIdempotency(operationId: string): boolean {
  const op = sqlEscape(operationId);
  const count = queryOne(`SELECT COUNT(*)::int FROM cortana_events WHERE event_type='idempotent_operation' AND COALESCE(metadata->>'operation_id','')='${op}' AND COALESCE(metadata->>'status','') IN ('completed','success','done');`).replace(/\s/g, "") || "0";
  return Number(count) > 0;
}
function logIdempotency(operationId: string, operationType: string, status: string, metadata = "{}") {
  const op = sqlEscape(operationId), typ = sqlEscape(operationType), st = sqlEscape(status), meta = sqlEscape(metadata);
  runPsql(`INSERT INTO cortana_events (event_type, source, severity, message, metadata)
    VALUES ('idempotent_operation','${SOURCE}',CASE WHEN '${st}' IN ('failed','error') THEN 'error' WHEN '${st}' IN ('skipped','duplicate') THEN 'warning' ELSE 'info' END,
    'Idempotent operation ${typ} -> ${st}',COALESCE('${meta}'::jsonb,'{}'::jsonb)||jsonb_build_object('operation_id','${op}','operation_type','${typ}','status','${st}','logged_at',NOW()::text));`);
}
function emitRunEvent(runId: string, taskId: string | number | null, eventType: string, metadata: Json) {
  if (!fs.existsSync(EMIT_RUN_EVENT_SCRIPT)) return;
  spawnSync(EMIT_RUN_EVENT_SCRIPT, [runId, taskId == null ? "" : String(taskId), eventType, SOURCE, JSON.stringify(metadata)], { stdio: "ignore", env: withPostgresPath(process.env) });
}
function extractRunId(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return parsed?.run_id ?? parsed?.runId ?? parsed?.id ?? "";
  } catch {}
  const m = text.match(/(?:run_id|runId)\s*[:=]\s*([A-Za-z0-9:_-]+)/i);
  return m?.[1] ?? "";
}
function rollbackIfPossible(cwd: string, rollbackCmd: string) {
  if (!rollbackCmd) return;
  const r = spawnSync("bash", ["-lc", rollbackCmd], { cwd, encoding: "utf8" });
  const out = ((r.stdout ?? "") + (r.stderr ?? "")).split("\n").slice(-40).join("\n");
  const escOut = sqlEscape(out); const escCmd = sqlEscape(rollbackCmd);
  if (r.status === 0) auditEvent("auto_executor_rollback_success", "info", "Rollback succeeded", `{"rollback_cmd":"${escCmd}","output":"${escOut}"}`);
  else auditEvent("auto_executor_rollback_failed", "error", "Rollback failed", `{"rollback_cmd":"${escCmd}","output":"${escOut}","rc":${r.status ?? 1}}`);
}

function main() {
  const recentFailures = Number((queryOne(`SELECT COUNT(*)::int FROM cortana_events WHERE source='${SOURCE}' AND event_type='auto_executor_task_failed' AND timestamp >= NOW() - INTERVAL '1 hour';`) || "0").replace(/\s/g, ""));
  if (recentFailures >= MAX_FAILURES_PER_HOUR) {
    const pauseUntil = queryOne(`SELECT COALESCE((metadata->>'pause_until')::timestamptz, NOW() - INTERVAL '1 second') FROM cortana_events WHERE source='${SOURCE}' AND event_type='auto_executor_circuit_breaker' ORDER BY timestamp DESC LIMIT 1;`);
    const pauseEpoch = Date.parse(pauseUntil.replace(" ", "T").replace(/\.(\d+)/, ""));
    if (!Number.isNaN(pauseEpoch) && pauseEpoch > Date.now()) {
      auditEvent("auto_executor_skipped_circuit_open", "warning", "Circuit breaker open; auto-executor paused", `{"recent_failures":${recentFailures},"pause_until":"${pauseUntil}"}`);
      console.log(`Circuit breaker open until ${pauseUntil}`); process.exit(0);
    }
    const newPause = queryOne(`SELECT (NOW() + INTERVAL '${PAUSE_MINUTES} minutes')::text;`);
    auditEvent("auto_executor_circuit_breaker", "warning", "Circuit breaker tripped due to repeated failures", `{"recent_failures":${recentFailures},"max_failures_per_hour":${MAX_FAILURES_PER_HOUR},"pause_until":"${newPause}"}`);
    console.log(`Circuit breaker tripped: ${recentFailures} failures/hour. Pausing for ${PAUSE_MINUTES} minutes.`); process.exit(0);
  }

  const taskRowText = queryOne(`SELECT row_to_json(t) FROM (SELECT id, title, description, execution_plan, metadata FROM cortana_tasks WHERE status='ready' AND auto_executable=TRUE AND (execute_at IS NULL OR execute_at <= NOW()) AND (depends_on IS NULL OR NOT EXISTS (SELECT 1 FROM cortana_tasks t2 WHERE t2.id = ANY(cortana_tasks.depends_on) AND t2.status != 'completed')) ORDER BY priority ASC, created_at ASC LIMIT 1) t;`);
  if (!taskRowText.trim()) {
    logTaskDecision("auto_executor_no_ready_tasks", "skipped", "No dependency-ready auto-executable tasks found", "0.99");
    auditEvent("auto_executor_no_ready_tasks", "info", "No dependency-ready auto-executable tasks found", "{}");
    console.log("No ready auto-executable tasks."); process.exit(0);
  }
  const task = JSON.parse(taskRowText);
  const taskId = String(task.id), title = String(task.title ?? ""), plan = String(task.execution_plan ?? "");
  const assigned = "auto-executor", taskType = String(task.metadata?.task_type ?? "unknown");
  const operationId = genOperationId(), operationType = `auto_executor_task_${taskId}`;
  if (checkIdempotency(operationId)) { logIdempotency(operationId, operationType, "skipped", JSON.stringify({ task_id: Number(taskId), reason: "already_completed" })); console.log(`Skipping task #${taskId}: operation ${operationId} already completed.`); process.exit(0); }
  logIdempotency(operationId, operationType, "started", JSON.stringify({ task_id: Number(taskId), title, task_type: taskType }));

  if (!isTypeAllowed(taskType)) {
    const reason = `Skipped by task type allowlist: task_type='${taskType}'`; runPsql(`UPDATE cortana_tasks SET status='ready', outcome='${sqlEscape(reason)}' WHERE id=${taskId};`);
    auditEvent("auto_executor_task_type_blocked", "warning", reason, `{"task_id":${taskId},"task_type":"${taskType}","allowlist":"${ALLOW_TASK_TYPES}"}`);
    console.log(reason); process.exit(1);
  }

  const govRun = spawnSync("python3", ["/Users/hd/openclaw/tools/governor/risk_score.py", "--db", DB, "--task-json", JSON.stringify(task), "--actor", assigned, "--log", "--apply-task-state"], { encoding: "utf8", env: withPostgresPath(process.env) });
  if ((govRun.status ?? 1) !== 0) {
    console.log(`❌ auto-executor failed: governor risk_score.py exited ${(govRun.status ?? 1)}`);
    process.exit(govRun.status ?? 1);
  }
  const governor = JSON.parse(govRun.stdout || "{}");
  if (governor.decision !== "approved") {
    logTaskDecision(`auto_executor_governor_${governor.decision}`, "skipped", `Governor blocked execution (action_type=${governor.action_type}, risk=${governor.risk_score})`, "0.95", taskId);
    auditEvent("auto_executor_governor_block", "warning", "Governor blocked execution", JSON.stringify({ task_id: Number(taskId), decision: governor.decision, action_type: governor.action_type, risk: governor.risk_score }));
    console.log(`Governor ${governor.decision}: task #${taskId} queued/blocked (action_type=${governor.action_type}, risk=${governor.risk_score}).`); process.exit(0);
  }

  let runId = `autoexec:${taskId}:${Math.floor(Date.now() / 1000)}`;
  emitRunEvent(runId, taskId, "queued", { title, task_type: taskType, actor: assigned });
  runPsql(`BEGIN; UPDATE cortana_tasks SET status='in_progress', assigned_to='${assigned}', run_id=COALESCE(NULLIF(run_id,''), '${runId}') WHERE id=${taskId}; COMMIT;`);
  emitRunEvent(runId, taskId, "running", { title, task_type: taskType, actor: assigned });

  let cmd = String(task.metadata?.exec?.command ?? "") || plan;
  let cwd = String(task.metadata?.exec?.cwd ?? "") || "/Users/hd/Developer/cortana";
  const rollbackCmd = String(task.metadata?.exec?.rollback ?? "");

  if (!(cwd.startsWith(ALLOW_PREFIX_1) || cwd.startsWith(ALLOW_PREFIX_2))) {
    const reason = `Skipped by whitelist: cwd '${cwd}' is outside allowed repos`;
    runPsql(`UPDATE cortana_tasks SET status='ready', outcome='${sqlEscape(reason)}' WHERE id=${taskId};`);
    logTaskDecision("auto_executor_whitelist_block", "skipped", reason, "0.98", taskId); auditEvent("auto_executor_whitelist_block", "warning", reason, `{"task_id":${taskId},"cwd":"${sqlEscape(cwd)}"}`); console.log(reason); process.exit(1);
  }
  if (!cmd) {
    const reason = "Skipped: no executable command found in metadata.exec.command or execution_plan";
    runPsql(`UPDATE cortana_tasks SET status='ready', outcome='${sqlEscape(reason)}' WHERE id=${taskId};`);
    logTaskDecision("auto_executor_missing_command", "fail", reason, "0.99", taskId); auditEvent("auto_executor_missing_command", "error", reason, `{"task_id":${taskId}}`); console.log(reason); process.exit(1);
  }
  if (!/^(git (status|log|show|diff|fetch|pull|branch|rev-parse)|grep |find |ls |cat |head |tail |jq |python3? |node |npm (run )?test|go test|curl -s|openclaw |psql )/.test(cmd)) {
    const reason = `Skipped by command safelist: ${cmd}`;
    runPsql(`UPDATE cortana_tasks SET status='ready', outcome='${sqlEscape(reason)}' WHERE id=${taskId};`);
    logTaskDecision("auto_executor_safelist_block", "skipped", reason, "0.98", taskId); auditEvent("auto_executor_safelist_block", "warning", reason, `{"task_id":${taskId},"cmd":"${sqlEscape(cmd)}"}`); console.log(reason); process.exit(1);
  }

  auditEvent("auto_executor_task_started", "info", "Starting auto-execution for task", JSON.stringify({ task_id: Number(taskId), title, task_type: taskType, cwd, cmd }));
  const ex = spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8" });
  const out = `${ex.stdout ?? ""}${ex.stderr ?? ""}`;
  const rc = ex.status ?? 1;
  const shortOut = out.split("\n").slice(-60).join("\n");
  runId = extractRunId(out) || runId;
  const escOut = sqlEscape(shortOut), escCmd = sqlEscape(cmd), escRunId = sqlEscape(runId);

  if (rc === 0) {
    runPsql(`UPDATE cortana_tasks SET status='completed', completed_at=NOW(), outcome='Auto-executed by auto-executor. cmd=${escCmd}\\n${escOut}', assigned_to='${assigned}', run_id=COALESCE(NULLIF('${escRunId}',''), run_id), metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_auto_exec', NOW()::text, 'last_rc', 0, 'subagent_run_id', NULLIF('${escRunId}','')) WHERE id=${taskId};`);
    logTaskDecision(`auto_executor_task_${taskId}`, "success", `Task auto-executed successfully: ${title}`, "0.91", taskId); auditEvent("auto_executor_task_succeeded", "info", "Task auto-executed successfully", `{"task_id":${taskId},"rc":0}`);
    logIdempotency(operationId, operationType, "completed", JSON.stringify({ task_id: Number(taskId), title, run_id: runId || null, rc: 0 }));
    console.log(`Done task #${taskId}: ${title}`); return;
  }

  rollbackIfPossible(cwd, rollbackCmd);
  runPsql(`UPDATE cortana_tasks SET status='ready', outcome='Auto-exec failed (rc=${rc}). cmd=${escCmd}\\n${escOut}', assigned_to='${assigned}', run_id=COALESCE(NULLIF('${escRunId}',''), run_id), metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('last_auto_exec', NOW()::text, 'last_rc', ${rc}, 'subagent_run_id', NULLIF('${escRunId}','')) WHERE id=${taskId};`);
  logTaskDecision(`auto_executor_task_${taskId}`, "fail", `Task auto-execution failed rc=${rc}: ${title}`, "0.9", taskId);
  auditEvent("auto_executor_task_failed", "error", "Task auto-execution failed", `{"task_id":${taskId},"rc":${rc},"cmd":"${escCmd}","output":"${escOut}"}`);
  logIdempotency(operationId, operationType, "failed", JSON.stringify({ task_id: Number(taskId), title, run_id: runId || null, rc }));
  console.log(`Failed task #${taskId} rc=${rc}: ${title}`);
  process.exit(rc);
}

main();
