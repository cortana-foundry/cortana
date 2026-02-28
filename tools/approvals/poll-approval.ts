#!/usr/bin/env npx tsx

const API_BASE_DEFAULT = "http://localhost:3000/api/approvals";
const INTERVAL = 10;

function usage(): void {
  console.error(`Usage:
  poll-approval.ts <approval_id> [--timeout 300] [--api-base http://localhost:3000/api/approvals]`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const argv = process.argv.slice(2);
if (argv.length < 1) {
  usage();
  process.exit(1);
}

const approvalId = argv[0];
let timeout = 300;
let apiBase = API_BASE_DEFAULT;

for (let i = 1; i < argv.length; ) {
  const arg = argv[i];
  switch (arg) {
    case "--timeout":
      if (!argv[i + 1]) {
        usage();
        process.exit(1);
      }
      timeout = Number(argv[i + 1]);
      i += 2;
      break;
    case "--api-base":
    case "--api-url":
      if (!argv[i + 1]) {
        usage();
        process.exit(1);
      }
      apiBase = argv[i + 1];
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

async function main(): Promise<void> {
  const startTs = Math.floor(Date.now() / 1000);

  while (true) {
    const nowTs = Math.floor(Date.now() / 1000);
    const elapsed = nowTs - startTs;

    if (elapsed >= timeout) {
      process.stdout.write(
        `${JSON.stringify({
          ok: false,
          approval_id: approvalId,
          status: "timeout",
          timeout_seconds: timeout,
        })}\n`
      );
      process.exit(1);
    }

    const response = await fetch(`${apiBase}/${approvalId}`);
    const body = await response.text();

    if (response.ok) {
      const data = parseJson(body);
      let status = "";
      if (data && typeof data === "object") {
        if (typeof data.status === "string") {
          status = data.status;
        } else if (data.approval && typeof data.approval.status === "string") {
          status = data.approval.status;
        }
      }

      const statusLc = status.toLowerCase();
      if (statusLc && statusLc !== "pending") {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            approval_id: approvalId,
            status: statusLc,
            response: data ?? { raw: body },
          })}\n`
        );
        process.exit(0);
      }
    }

    const remaining = timeout - elapsed;
    const sleepFor = remaining < INTERVAL ? remaining : INTERVAL;
    if (sleepFor > 0) {
      await sleep(sleepFor * 1000);
    }
  }
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ ok: false, error: "request_failed", message: msg })}\n`);
  process.exit(1);
});
