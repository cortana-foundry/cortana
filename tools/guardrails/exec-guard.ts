#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";

function containsBlocked(cmd: string): boolean {
  return /(^|\s)openclaw\s+gateway\s+(restart|stop)(\s|$)/.test(cmd);
}

function guardExec(argv: string[]): number {
  const cmd = argv.join(" ");
  if (containsBlocked(cmd)) {
    console.error("[exec-guard] BLOCKED: sub-agents must not run 'openclaw gateway restart' or 'openclaw gateway stop'.");
    return 42;
  }

  const res = spawnSync(argv[0]!, argv.slice(1), { stdio: "inherit" });
  if (res.error) {
    console.error(res.error.message);
    return 1;
  }
  return res.status ?? 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(`Usage: ${process.argv[1] ?? "exec-guard.ts"} <command ...>`);
    process.exit(2);
  }
  process.exit(guardExec(args));
}

main();
