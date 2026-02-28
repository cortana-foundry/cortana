#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { runPsql, withPostgresPath } from "../../tools/lib/db.js";

const env = {
  ...withPostgresPath(process.env),
  PATH: `/opt/homebrew/bin:${withPostgresPath(process.env).PATH ?? ""}`,
};

function main() {
  const stateFile = path.join(os.homedir(), "clawd/cortical-loop/state/health-last-recovery.txt");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  let whoopRaw = "";
  try {
    whoopRaw = execFileSync("curl", ["-s", "http://localhost:3033/whoop/data"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
    });
  } catch {
    process.exit(0);
  }

  if (!whoopRaw.trim()) process.exit(0);

  let parsed: any;
  try {
    parsed = JSON.parse(whoopRaw);
  } catch {
    process.exit(0);
  }

  const recovery = parsed?.recovery?.[0]?.score?.recovery_score;
  const hrv = parsed?.recovery?.[0]?.score?.hrv_rmssd_milli;
  if (recovery === null || recovery === undefined || recovery === "") process.exit(0);

  const lastRecovery = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, "utf8").trim() : "";
  const recoveryStr = String(recovery);

  if (recoveryStr !== lastRecovery) {
    const payload = JSON.stringify({
      recovery_score: Number(recovery) || 0,
      hrv: Number(hrv) || 0,
    }).replace(/'/g, "''");

    runPsql(
      `INSERT INTO cortana_event_stream (source, event_type, payload) VALUES ('health', 'recovery_update', '${payload}'::jsonb);`,
      { env, args: ["-q"], stdio: "ignore" }
    );

    fs.writeFileSync(stateFile, `${recoveryStr}\n`, "utf8");
  }
}

main();
