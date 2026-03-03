#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { evaluateMainClean } from "./done-gates-lib.js";

type GateResult = { name: string; ok: boolean; details?: string[] };

function runShell(command: string): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runStep(name: string, command: string): GateResult {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    stdio: "inherit",
  });

  return {
    name,
    ok: result.status === 0,
    details: result.status === 0 ? undefined : [`command failed: ${command}`],
  };
}

export function runDoneGates(params?: { buildCmd?: string; testCmd?: string }): { ok: boolean; failures: GateResult[] } {
  const buildCmd = params?.buildCmd ?? process.env.DONE_GATES_BUILD_CMD ?? "npm run build";
  const testCmd = params?.testCmd ?? process.env.DONE_GATES_TEST_CMD;

  const checks: GateResult[] = [];

  checks.push(runStep("build passes", buildCmd));

  if (!testCmd) {
    checks.push({
      name: "targeted tests pass",
      ok: false,
      details: ["missing targeted test command (set DONE_GATES_TEST_CMD or pass --test-cmd)"],
    });
  } else {
    checks.push(runStep("targeted tests pass", testCmd));
  }

  const fetch = runShell("git fetch origin main --quiet");
  if (!fetch.ok) {
    checks.push({
      name: "local main clean",
      ok: false,
      details: ["git fetch origin main failed", fetch.stderr.trim()].filter(Boolean),
    });
  } else {
    const status = runShell("git status --porcelain");
    const aheadBehind = runShell("git rev-list --left-right --count origin/main...main");

    if (!status.ok || !aheadBehind.ok) {
      checks.push({
        name: "local main clean",
        ok: false,
        details: [
          !status.ok ? "git status --porcelain failed" : "",
          !aheadBehind.ok ? "git rev-list --left-right --count origin/main...main failed" : "",
          status.stderr.trim(),
          aheadBehind.stderr.trim(),
        ].filter(Boolean),
      });
    } else {
      const mainClean = evaluateMainClean(status.stdout, aheadBehind.stdout);
      checks.push({
        name: "local main clean",
        ok: mainClean.ok,
        details: mainClean.ok ? undefined : mainClean.reasons,
      });
    }
  }

  const failures = checks.filter((check) => !check.ok);
  return { ok: failures.length === 0, failures };
}

function parseFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1];
  const equals = args.find((a) => a.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  return undefined;
}

async function main(): Promise<void> {
  const buildCmd = parseFlag("--build-cmd");
  const testCmd = parseFlag("--test-cmd");

  const result = runDoneGates({ buildCmd, testCmd });
  if (result.ok) {
    console.log("✅ release done-gates passed");
    process.exit(0);
  }

  console.error("❌ release done-gates failed:");
  for (const failure of result.failures) {
    console.error(`- ${failure.name}`);
    for (const detail of failure.details ?? []) {
      console.error(`  • ${detail}`);
    }
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
