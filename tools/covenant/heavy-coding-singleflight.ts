#!/usr/bin/env npx tsx

import { spawnSync } from "child_process";

type Session = {
  key?: string;
  label?: string;
  status?: string;
  task?: string;
  mission?: string;
  objective?: string;
  summary?: string;
};

type QueuePolicy = "deny" | "allow";

type Decision = {
  ok: boolean;
  blocked: boolean;
  reason: string;
  maxConcurrent: number;
  activeHeavyCount: number;
  incomingHeavy: boolean;
  queuePolicy: QueuePolicy;
  backoffMs: number;
  activeHeavySessions: Array<{ key: string; label: string; status: string }>;
};

type GuardArgs = {
  maxConcurrent: number;
  queuePolicy: QueuePolicy;
  requestLabel: string;
  requestMission: string;
  backoffMs: number;
};

const HEAVY_CODING_PATTERNS = [
  /\bcodex\b/i,
  /\bclaude code\b/i,
  /\bpi\b/i,
  /\bcoding\b/i,
  /\bimplement\b/i,
  /\brefactor\b/i,
  /\bbuild\b/i,
  /\bfix\b/i,
  /\bpr\b/i,
  /\bpull request\b/i,
  /\btest(s|ing)?\b/i,
];

export function parseArgs(argv: string[]): GuardArgs {
  let maxConcurrent = Number(process.env.HEAVY_CODING_MAX_CONCURRENT ?? "2");
  let queuePolicy: QueuePolicy = (process.env.HEAVY_CODING_QUEUE_POLICY as QueuePolicy) || "deny";
  let requestLabel = "";
  let requestMission = "";
  let backoffMs = Number(process.env.HEAVY_CODING_BACKOFF_MS ?? "30000");

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--max-concurrent") {
      maxConcurrent = Number(argv[i + 1] ?? maxConcurrent);
      i += 1;
    } else if (arg === "--queue-policy") {
      const raw = String(argv[i + 1] ?? "").toLowerCase();
      if (raw === "deny" || raw === "allow") queuePolicy = raw;
      i += 1;
    } else if (arg === "--request-label") {
      requestLabel = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (arg === "--request-mission") {
      requestMission = String(argv[i + 1] ?? "").trim();
      i += 1;
    } else if (arg === "--backoff-ms") {
      backoffMs = Number(argv[i + 1] ?? backoffMs);
      i += 1;
    }
  }

  if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) maxConcurrent = 1;
  if (!Number.isFinite(backoffMs) || backoffMs < 0) backoffMs = 0;
  return { maxConcurrent, queuePolicy, requestLabel, requestMission, backoffMs };
}

function readSessions(): Session[] {
  const proc = spawnSync("openclaw", ["sessions", "--json", "--all-agents", "--active", "240"], {
    encoding: "utf8",
  });

  if (proc.status !== 0) {
    throw new Error((proc.stderr || proc.stdout || "openclaw sessions failed").trim());
  }

  const parsed = JSON.parse(proc.stdout || "{}");
  const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  return sessions as Session[];
}

function textFor(session: Session): string {
  return [session.label, session.task, session.mission, session.objective, session.summary, session.key]
    .filter(Boolean)
    .join(" ");
}

export function isHeavyCodingText(text: string): boolean {
  return HEAVY_CODING_PATTERNS.some((rx) => rx.test(text));
}

export function isActiveSubagent(session: Session): boolean {
  const key = String(session.key || "");
  if (!key.includes(":subagent:")) return false;
  const status = String(session.status || "").toLowerCase();
  return !["completed", "failed", "timeout", "killed", "cancelled", "canceled"].includes(status);
}

export function decideSingleFlight(sessions: Session[], args: GuardArgs): Decision {
  const activeSubagents = sessions.filter(isActiveSubagent);
  const heavy = activeSubagents.filter((s) => isHeavyCodingText(textFor(s)));
  const incomingText = [args.requestLabel, args.requestMission].filter(Boolean).join(" ");
  const incomingHeavy = incomingText ? isHeavyCodingText(incomingText) : true;

  const saturated = incomingHeavy && heavy.length >= args.maxConcurrent;
  const blocked = saturated && args.queuePolicy === "deny";

  return {
    ok: !blocked,
    blocked,
    reason: blocked
      ? `single_flight_blocked: active_heavy=${heavy.length} max=${args.maxConcurrent}`
      : saturated
        ? "single_flight_saturated_queue_allowed"
        : "single_flight_ok",
    maxConcurrent: args.maxConcurrent,
    activeHeavyCount: heavy.length,
    incomingHeavy,
    queuePolicy: args.queuePolicy,
    backoffMs: saturated ? args.backoffMs : 0,
    activeHeavySessions: heavy.map((s) => ({
      key: String(s.key || ""),
      label: String(s.label || ""),
      status: String(s.status || "unknown"),
    })),
  };
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv);
  const decision = decideSingleFlight(readSessions(), args);
  console.log(JSON.stringify(decision, null, 2));
  return decision.blocked ? 2 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(runCli(process.argv.slice(2)));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          blocked: false,
          reason: "single_flight_guard_error",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      )
    );
    process.exit(1);
  }
}
