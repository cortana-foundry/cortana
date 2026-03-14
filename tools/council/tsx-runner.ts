import { spawnSync } from "node:child_process";

export function buildTsxInvocation(file: string, args: string[]): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["--import", "tsx", file, ...args],
  };
}

export function runTsxScript(file: string, args: string[]): string {
  const invocation = buildTsxInvocation(file, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8" });

  if (result.error) {
    throw new Error(`Failed to launch tsx script '${file}': ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "tsx script failed").trim());
  }

  return (result.stdout || "").trim();
}
