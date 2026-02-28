#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { query } from "../lib/db.js";

type Candidate = {
  source: string;
  pillar: string;
  title: string;
  rationale: string;
  urgency: number;
  impact: number;
  reversibility: number;
  effort: number;
  metadata: Record<string, unknown>;
};

const score = (c: Candidate) => Number(((c.urgency * c.impact * c.reversibility) / Math.max(c.effort, 0.6)).toFixed(3));
const ET = "America/New_York";

function runPsql(sql: string): string {
  return query(sql).trim();
}

function fetchJson(sql: string): any[] {
  const wrapped = `SELECT COALESCE(json_agg(t), '[]'::json)::text FROM (${sql}) t;`;
  const raw = runPsql(wrapped);
  return raw ? JSON.parse(raw) : [];
}

function ensureTables(): void {
  runPsql("CREATE TABLE IF NOT EXISTS cortana_decision_queue_runs (id BIGSERIAL PRIMARY KEY, generated_at TIMESTAMPTZ DEFAULT NOW(), metadata JSONB DEFAULT '{}'::jsonb);");
  runPsql("CREATE TABLE IF NOT EXISTS cortana_decision_queue_feedback (id BIGSERIAL PRIMARY KEY, run_id BIGINT REFERENCES cortana_decision_queue_runs(id) ON DELETE CASCADE, item_rank INT NOT NULL, title TEXT NOT NULL, pillar TEXT NOT NULL, source TEXT NOT NULL, score NUMERIC(8,3) NOT NULL, accepted BOOLEAN, completed BOOLEAN, completed_at TIMESTAMPTZ, metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW());");
}

function nowEt(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: ET }));
}

function parseDt(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function gogEvents(): any[] {
  const to = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const p = spawnSync("gog", ["calendar", "events", "primary", "--from", "today", "--to", to, "--json"], { encoding: "utf8" });
  if (p.status !== 0 || !p.stdout.trim()) return [];
  try {
    const js = JSON.parse(p.stdout);
    return Array.isArray(js) ? js : (js.events ?? []);
  } catch {
    return [];
  }
}

function fromCalendar(now: Date): Candidate[] {
  const out: Candidate[] = [];
  for (const ev of gogEvents()) {
    const s = typeof ev.start === "object" ? ev.start : { dateTime: ev.start };
    const st = parseDt(s.dateTime ?? s.date);
    if (!st) continue;
    if (st < now || st > new Date(now.getTime() + 24 * 3600 * 1000)) continue;
    const mins = Math.max(1, Math.floor((st.getTime() - now.getTime()) / 60000));
    const urgency = mins < 120 ? 5.0 : mins < 360 ? 4.0 : 3.0;
    const title = String(ev.summary ?? "Calendar commitment");
    out.push({
      source: "calendar", pillar: "Time", title: `Prepare: ${title}`,
      rationale: `Starts in ${mins}m — protect prep/context-switch time.`,
      urgency, impact: 3.8, reversibility: 4.0, effort: 2.2,
      metadata: { event_start: st.toISOString(), event_id: ev.id },
    });
  }
  return out;
}

function fromWatchlist(): Candidate[] {
  let rows: any[] = [];
  try {
    rows = fetchJson("SELECT category, item, condition, threshold, metadata FROM cortana_watchlist WHERE enabled IS DISTINCT FROM FALSE ORDER BY created_at DESC LIMIT 10");
  } catch {}
  return rows.slice(0, 4).map((r) => ({
    source: "watchlist", pillar: "Wealth", title: `Review ${String(r.item ?? "watchlist")} setup quality`,
    rationale: "Pre-commit entry/exit before open; reduce impulse execution.",
    urgency: 3.5, impact: 4.4, reversibility: 3.7, effort: 1.8,
    metadata: { item: r.item, category: r.category, condition: r.condition, threshold: r.threshold, raw: r.metadata },
  }));
}

function fromTasks(): Candidate[] {
  const rows = fetchJson("SELECT id, title, priority, due_at, auto_executable FROM cortana_tasks WHERE status IN ('ready','in_progress') ORDER BY priority ASC, due_at ASC NULLS LAST LIMIT 12");
  const now = nowEt();
  return rows.map((r) => {
    const due = r.due_at ? parseDt(r.due_at) : null;
    const urgency = due && due < new Date(now.getTime() + 24 * 3600 * 1000) ? 4.5 : 3.2;
    return {
      source: "tasks", pillar: "Career", title: `Task #${r.id}: ${r.title}`,
      rationale: `${due ? "Due soon" : "Pending task"}, priority P${r.priority ?? 3}.`,
      urgency, impact: 4.0, reversibility: 3.2, effort: 2.8,
      metadata: { task_id: r.id, due_at: r.due_at, auto: r.auto_executable },
    };
  });
}

function fromProactive(): Candidate[] {
  const rows = fetchJson("SELECT source, signal_type, title, summary, confidence, severity FROM cortana_proactive_signals ORDER BY created_at DESC LIMIT 15");
  return rows.map((r) => {
    const conf = Number(r.confidence ?? 0.6);
    const sev = String(r.severity ?? "medium");
    const urgency = sev === "high" ? 4.6 : 3.6;
    return {
      source: "proactive", pillar: "Time", title: String(r.title ?? "Proactive signal"),
      rationale: String(r.summary ?? "Proactive detector surfaced a relevant signal."),
      urgency, impact: 3.5 + conf, reversibility: 3.0, effort: 2.0,
      metadata: { signal_type: r.signal_type, confidence: conf },
    };
  });
}

function fromRiskRadar(): Candidate[] {
  const script = "/Users/hd/openclaw/tools/proactive/risk_radar.py";
  const p = spawnSync("python3", [script, "--horizon-hours", "16", "--json"], { encoding: "utf8" });
  if (p.status !== 0 || !p.stdout.trim()) return [];
  let js: any;
  try { js = JSON.parse(p.stdout); } catch { return []; }

  const scores = js.scores ?? {};
  const recovery = Number(scores.recovery_score ?? 55);
  const combined = Number(scores.combined_risk_score ?? 50);

  if (combined >= 65) {
    return [{ source: "risk_radar", pillar: "Health", title: "Defend readiness window", rationale: `Recovery ${recovery.toFixed(0)} + elevated combined risk ${combined.toFixed(0)}.`, urgency: 4.8, impact: 4.5, reversibility: 4.4, effort: 2.0, metadata: { scores, priority_mitigations: js.priority_mitigations ?? [] } }];
  }
  return [{ source: "risk_radar", pillar: "Health", title: "Lock in baseline recovery protections", rationale: `Combined risk ${combined.toFixed(0)}; stay disciplined to avoid preventable drift.`, urgency: 3.1, impact: 3.8, reversibility: 4.2, effort: 1.7, metadata: { scores } }];
}

function selectTop(candidates: Candidate[], topN: number): Candidate[] {
  const ranked = [...candidates].sort((a, b) => score(b) - score(a));
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const c of ranked) {
    if (seen.has(c.pillar)) continue;
    out.push(c); seen.add(c.pillar);
    if (out.length >= topN) return out;
  }
  for (const c of ranked) {
    if (out.includes(c)) continue;
    out.push(c);
    if (out.length >= topN) break;
  }
  return out;
}

function persistFeedbackStub(top: Candidate[]): number {
  ensureTables();
  const runId = Number(runPsql("INSERT INTO cortana_decision_queue_runs (metadata) VALUES ('{}'::jsonb) RETURNING id;"));
  for (let i = 0; i < top.length; i += 1) {
    const c = top[i];
    const esc = (s: string) => s.replace(/'/g, "''");
    const meta = JSON.stringify(c.metadata).replace(/'/g, "''");
    runPsql(`INSERT INTO cortana_decision_queue_feedback (run_id, item_rank, title, pillar, source, score, metadata) VALUES (${runId}, ${i + 1}, '${esc(c.title)}', '${esc(c.pillar)}', '${esc(c.source)}', ${score(c).toFixed(3)}, '${meta}'::jsonb);`);
  }
  return runId;
}

function recordFeedback(runId: number, rank: number, accepted?: boolean, completed?: boolean): void {
  const sets: string[] = [];
  if (accepted !== undefined) sets.push(`accepted=${accepted ? "TRUE" : "FALSE"}`);
  if (completed !== undefined) {
    sets.push(`completed=${completed ? "TRUE" : "FALSE"}`);
    if (completed) sets.push("completed_at=NOW()");
  }
  if (!sets.length) return;
  runPsql(`UPDATE cortana_decision_queue_feedback SET ${sets.join(", ")} WHERE run_id=${runId} AND item_rank=${rank};`);
}

const formatBrief = (top: Candidate[]) => top.map((c, i) => `${i + 1}) [${c.pillar}] ${c.title} — ${c.rationale}`);

function parseArgs(argv: string[]) {
  const args: any = { top: 3, json: false, recordFeedback: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--top") args.top = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--record-feedback") args.recordFeedback = true;
    else if (a === "--feedback-run-id") args.feedbackRunId = Number(argv[++i]);
    else if (a === "--feedback-rank") args.feedbackRank = Number(argv[++i]);
    else if (a === "--accepted") args.accepted = argv[++i];
    else if (a === "--completed") args.completed = argv[++i];
  }
  return args;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));

  if (args.feedbackRunId && args.feedbackRank) {
    recordFeedback(args.feedbackRunId, args.feedbackRank, args.accepted === undefined ? undefined : args.accepted === "true", args.completed === undefined ? undefined : args.completed === "true");
    console.log(JSON.stringify({ ok: true, run_id: args.feedbackRunId, rank: args.feedbackRank }, null, 2));
    return 0;
  }

  const now = nowEt();
  const candidates = [...fromCalendar(now), ...fromWatchlist(), ...fromTasks(), ...fromProactive(), ...fromRiskRadar()];
  const top = selectTop(candidates, args.top);
  const runId = args.recordFeedback ? persistFeedbackStub(top) : null;

  const output = {
    generated_at: now.toISOString(),
    candidate_count: candidates.length,
    top_n: args.top,
    run_id: runId,
    top_moves: top.map((c) => ({ ...c, score: score(c) })),
    formatted_queue: formatBrief(top),
  };

  if (args.json) console.log(JSON.stringify(output, null, 2));
  else console.log(output.formatted_queue.join("\n"));
  return 0;
}

process.exit(main());
