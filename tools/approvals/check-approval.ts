#!/usr/bin/env npx tsx

const API_URL_DEFAULT = "http://localhost:3000/api/approvals";

type Json = Record<string, unknown>;

function usage(): void {
  console.error(`Usage:
  check-approval.ts <action_type> <agent_id> <risk_level> <rationale> [proposal_json]
  check-approval.ts --agent <agent_id> --action <action_type> --risk <risk_level> --rationale <text> [--proposal <json>] [--api-url <url>]

Risk values accepted: p0|p1|p2|p3 (case-insensitive), 0|1|2|3, critical|high|medium|low`);
}

function out(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function normalizeRisk(rawInput: string): string | null {
  const raw = rawInput.toLowerCase();
  switch (raw) {
    case "p0":
    case "0":
    case "critical":
      return "p0";
    case "p1":
    case "1":
    case "high":
      return "p1";
    case "p2":
    case "2":
    case "medium":
    case "med":
      return "p2";
    case "p3":
    case "3":
    case "low":
      return "p3";
    default:
      return null;
  }
}

function parseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractApprovalId(body: string): string {
  const data = parseJson(body);
  if (!data || typeof data !== "object") return "";
  const dict = data as Json;

  for (const key of ["approval_id", "id"]) {
    const val = dict[key];
    if (typeof val === "string" && val) return val;
  }

  const approval = dict.approval;
  if (approval && typeof approval === "object") {
    const approvalObj = approval as Json;
    for (const key of ["approval_id", "id"]) {
      const val = approvalObj[key];
      if (typeof val === "string" && val) return val;
    }
  }

  return "";
}

let actionType = "";
let agentId = "";
let riskInput = "";
let rationale = "";
let proposalJson = "{}";
let apiUrl = API_URL_DEFAULT;

const argv = process.argv.slice(2);
if (argv.length === 0) {
  usage();
  process.exit(1);
}

if (argv[0].startsWith("--")) {
  for (let i = 0; i < argv.length; ) {
    const arg = argv[i];
    switch (arg) {
      case "--agent":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        agentId = argv[i + 1];
        i += 2;
        break;
      case "--action":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        actionType = argv[i + 1];
        i += 2;
        break;
      case "--risk":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        riskInput = argv[i + 1];
        i += 2;
        break;
      case "--rationale":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        rationale = argv[i + 1];
        i += 2;
        break;
      case "--proposal":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        proposalJson = argv[i + 1];
        i += 2;
        break;
      case "--api-url":
        if (!argv[i + 1]) {
          usage();
          process.exit(1);
        }
        apiUrl = argv[i + 1];
        i += 2;
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
        process.exit(1);
    }
  }
} else {
  if (argv.length < 4) {
    usage();
    process.exit(1);
  }
  [actionType, agentId, riskInput, rationale] = argv;
  proposalJson = argv[4] ?? "{}";
}

if (!(actionType && agentId && riskInput && rationale)) {
  usage();
  process.exit(1);
}

const riskLevel = normalizeRisk(riskInput);
if (!riskLevel) {
  out({ ok: false, error: "invalid_risk_level" });
  process.exit(1);
}

const proposal = parseJson(proposalJson);
if (proposal === null) {
  out({ ok: false, error: "invalid_proposal_json" });
  process.exit(1);
}

const payload = JSON.stringify({
  agent_id: agentId,
  action_type: actionType,
  proposal,
  rationale,
  risk_level: riskLevel,
});

async function main(): Promise<void> {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  });

  const body = await response.text();
  const parsed = parseJson(body) ?? { raw: body };

  if (!response.ok) {
    out({
      ok: false,
      http_status: response.status,
      risk_level: riskLevel,
      error: "approval_create_failed",
      response: parsed,
    });
    process.exit(1);
  }

  const approvalId = extractApprovalId(body);

  if (riskLevel === "p3") {
    out({
      ok: true,
      status: "approved",
      auto_approved: true,
      risk_level: "p3",
      approval_id: approvalId || null,
      response: parsed,
    });
    process.exit(0);
  }

  if (!approvalId) {
    out({
      ok: false,
      error: "missing_approval_id",
      response: parsed,
    });
    process.exit(1);
  }

  out({
    ok: true,
    status: "pending",
    auto_approved: false,
    risk_level: riskLevel,
    approval_id: approvalId,
    response: parsed,
  });
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  out({ ok: false, error: "request_failed", message: msg });
  process.exit(1);
});
