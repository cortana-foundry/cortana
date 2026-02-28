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

function getEtHourMinute(): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? "0"),
  };
}

function getDow(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function main() {
  const dow = getDow();
  if (dow > 5) process.exit(0);

  const { hour, minute } = getEtHourMinute();
  const marketMin = hour * 60 + minute;
  if (marketMin < 570 || marketMin > 960) process.exit(0);

  const stateFile = path.join(os.homedir(), "clawd/cortical-loop/state/portfolio-baselines.json");
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const tickers = ["TSLA", "NVDA", "GOOGL", "AAPL", "QQQ"];

  for (const ticker of tickers) {
    let result = "";
    try {
      result = execFileSync(
        "curl",
        ["-s", `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=1d&interval=1d`],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env }
      );
    } catch {
      continue;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(result);
    } catch {
      continue;
    }

    const price = parsed?.chart?.result?.[0]?.meta?.regularMarketPrice;
    const prevClose = parsed?.chart?.result?.[0]?.meta?.chartPreviousClose;
    if (price === null || price === undefined || prevClose === null || prevClose === undefined) continue;

    const changePct = Number((((Number(price) - Number(prevClose)) / Number(prevClose)) * 100).toFixed(2));
    const above = changePct > 3 || changePct < -3;

    if (above) {
      const payload = JSON.stringify({
        ticker,
        price: Number(price),
        change_pct: changePct,
      }).replace(/'/g, "''");

      runPsql(
        `INSERT INTO cortana_event_stream (source, event_type, payload) VALUES ('finance', 'price_alert', '${payload}'::jsonb);`,
        { env, args: ["-q"], stdio: "ignore" }
      );
    }
  }
}

main();
