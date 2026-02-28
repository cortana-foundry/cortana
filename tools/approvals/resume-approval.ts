#!/usr/bin/env npx tsx

const API_BASE_DEFAULT = "http://localhost:3000/api/approvals";

function usage(): void {
  process.stderr.write(`Usage:\n  resume-approval.sh <approval_id> [--result '{"key":"value"}'] [--api-base http://localhost:3000/api/approvals]\n`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    usage();
    return 1;
  }

  const approvalId = argv.shift() as string;
  let apiBase = API_BASE_DEFAULT;
  let resultJson = "";

  while (argv.length > 0) {
    const arg = argv[0];
    if (arg === "--result") {
      if (argv.length < 2) {
        usage();
        return 1;
      }
      resultJson = argv[1];
      argv.splice(0, 2);
      continue;
    }
    if (arg === "--api-base" || arg === "--api-url") {
      if (argv.length < 2) {
        usage();
        return 1;
      }
      apiBase = argv[1];
      argv.splice(0, 2);
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      return 0;
    }
    process.stderr.write(`Unknown argument: ${arg}\n`);
    usage();
    return 1;
  }

  let payload: string;
  if (resultJson) {
    try {
      payload = JSON.stringify({ execution_result: JSON.parse(resultJson) });
    } catch {
      process.stderr.write("Invalid JSON for --result\n");
      return 1;
    }
  } else {
    payload = "{}";
  }

  let res: Response;
  try {
    res = await fetch(`${apiBase}/${approvalId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: "approval_resume_failed", response: { raw: String(error) } }) + "\n");
    return 1;
  }

  const body = await res.text();
  if (res.status >= 200 && res.status < 300) {
    try {
      JSON.parse(body);
      process.stdout.write(`${body}\n`);
    } catch {
      process.stdout.write(`${JSON.stringify({ raw: body })}\n`);
    }
    return 0;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { raw: body };
  }

  process.stdout.write(
    `${JSON.stringify({ ok: false, http_status: res.status, error: "approval_resume_failed", response: parsed })}\n`,
  );
  return 1;
}

void main().then((code) => process.exit(code));
