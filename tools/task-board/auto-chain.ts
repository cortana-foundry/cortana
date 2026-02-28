#!/usr/bin/env npx tsx
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withPostgresPath } from "../lib/db.js";
import { PSQL_BIN, repoRoot } from "../lib/paths.js";

const DB_NAME = process.env.CORTANA_DB ?? "cortana";
const ROOT_DIR = repoRoot();
const RULES_FILE = process.env.AUTO_CHAIN_RULES_FILE ?? path.join(ROOT_DIR, "config/auto-chain-rules.json");
const SOURCE = "task-board-auto-chain";

const usage = `Auto-chain rules engine for cortana_tasks.\n\nUsage:\n  auto-chain.sh evaluate <completed_task_id>\n\nBehavior:\n  - Reads completed task title/outcome\n  - Matches against config/auto-chain-rules.json\n  - Outputs JSON recommendations\n  - If rule.auto_execute=true, creates follow-up task(s) in cortana_tasks\n  - Logs evaluation/actions to cortana_events`;

const esc = (s = "") => s.replace(/'/g, "''");
const psqlOut = (sql: string) => (spawnSync(PSQL_BIN, [DB_NAME, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: withPostgresPath(process.env) }).stdout ?? "").trim();

function requireBins() {
  if (!fs.existsSync(PSQL_BIN)) { console.log('{"ok":false,"error":"psql_not_found"}'); process.exit(1); }
  if (spawnSync("bash", ["-lc", "command -v jq"], { stdio: "ignore" }).status !== 0) { console.log('{"ok":false,"error":"jq_not_found"}'); process.exit(1); }
  if (!fs.existsSync(RULES_FILE)) { console.log(JSON.stringify({ ok: false, error: "rules_file_missing", path: RULES_FILE })); process.exit(1); }
}
function isInt(v?: string) { return !!v && /^\d+$/.test(v); }

function logEvent(eventType: string, severity: string, message: string, metadata: any) {
  psqlOut(`INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('${esc(eventType)}','${SOURCE}','${esc(severity)}','${esc(message)}','${esc(JSON.stringify(metadata))}'::jsonb);`);
}

function fetchTask(taskId: number): any | null {
  const row = psqlOut(`SELECT row_to_json(t)::text FROM (SELECT id, title, description, outcome, status, priority, source FROM cortana_tasks WHERE id = ${taskId} LIMIT 1) t;`);
  if (!row.trim()) return null;
  return JSON.parse(row);
}

function createFollowupTask(completedTaskId: number, completedTitle: string, nextAction: string, agentRole: string): number {
  const desc = `Auto-chain follow-up from completed task #${completedTaskId}: ${completedTitle}. Suggested action: ${nextAction}.`;
  const metadata = { auto_chain: true, engine: "auto-chain", agent_role: agentRole, next_action: nextAction, from_completed_task_id: completedTaskId };
  const id = psqlOut(`INSERT INTO cortana_tasks (title, description, priority, auto_executable, source, status, metadata) VALUES ('${esc(nextAction)}','${esc(desc)}',3,FALSE,'auto-chain','ready','${esc(JSON.stringify(metadata))}'::jsonb) RETURNING id;`).replace(/\s/g, "");
  return Number(id);
}

function evaluate(taskId: number) {
  const task = fetchTask(taskId);
  if (!task) { console.log(JSON.stringify({ ok: false, error: "task_not_found", task_id: taskId })); process.exit(1); }

  const status = String(task.status ?? "");
  const title = String(task.title ?? "");
  const matchText = `${title}\n${task.description ?? ""}\n${task.outcome ?? ""}`;

  const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8")).rules ?? [];
  const matched = rules.filter((r: any) => {
    try { return new RegExp(String(r.trigger_task_pattern), "i").test(matchText); } catch { return false; }
  });

  logEvent("auto_chain_evaluated", "info", `Auto-chain evaluated task #${taskId} (status=${status}), matches=${matched.length}`, { task_id: taskId, status, matched_count: matched.length, rules_file: RULES_FILE });

  const recs: any[] = [];
  for (const rule of matched) {
    const trigger = String(rule.trigger_task_pattern ?? "");
    const nextAction = String(rule.next_action ?? "");
    const agentRole = String(rule.agent_role ?? "");
    const autoExecute = rule.auto_execute === true;
    let createdTaskId: number | null = null;

    if (autoExecute) {
      createdTaskId = createFollowupTask(taskId, title, nextAction, agentRole);
      logEvent("auto_chain_task_created", "info", `Auto-chain created follow-up task #${createdTaskId} from completed task #${taskId}`, { task_id: taskId, created_task_id: createdTaskId, trigger_task_pattern: trigger, next_action: nextAction, agent_role: agentRole, auto_execute: true });
    } else {
      logEvent("auto_chain_rule_matched", "info", `Auto-chain matched non-auto rule for task #${taskId}`, { task_id: taskId, trigger_task_pattern: trigger, next_action: nextAction, agent_role: agentRole, auto_execute: false });
    }

    recs.push({ trigger_task_pattern: trigger, next_action: nextAction, agent_role: agentRole, auto_execute: autoExecute, created_task_id: createdTaskId });
  }

  console.log(JSON.stringify({ ok: true, completed_task_id: taskId, completed_task_status: status, completed_task_title: title, matched_rules_count: matched.length, rules_file: RULES_FILE, recommendations: recs }));
}

function main() {
  requireBins();
  const cmd = process.argv[2] ?? "";
  if (cmd === "evaluate") {
    const taskId = process.argv[3] ?? "";
    if (!isInt(taskId)) { console.log(usage); console.log('{"ok":false,"error":"invalid_task_id"}'); process.exit(1); }
    evaluate(Number(taskId));
    return;
  }
  console.log(usage);
  process.exit(1);
}

main();
