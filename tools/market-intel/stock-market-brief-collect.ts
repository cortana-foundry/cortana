#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { getMarketSessionInfo } from "../../skills/markets/check_market_status.ts";

export const DEFAULT_ARTIFACT_PATH = "/tmp/cron-stock-market-brief.json";
export const EXTERNAL_BACKTESTER_DIR = "/Users/hd/Developer/cortana-external/backtester";

export type MarketBriefSnapshot = {
  generated_at: string;
  status: string;
  warnings?: string[];
  regime: {
    label: string;
    display: string;
    position_sizing_pct: number;
    distribution_days: number;
    regime_score: number;
    notes: string;
    status: string;
    data_source: string;
    degraded_reason?: string | null;
  };
  posture: { action: string; reason: string };
  macro: {
    state: string;
    conviction?: string;
    summary_line: string;
    theme_titles?: string[];
  };
  tape: {
    summary_line: string;
    risk_tone: string;
    primary_source: string;
    symbols: Array<Record<string, unknown>>;
  };
  focus: {
    symbols: string[];
    sources?: string[];
  };
  freshness?: Record<string, unknown>;
};

export type StockMarketBriefArtifact = {
  artifact_version: 1;
  generated_at: string;
  source: "cortana-external";
  session: { phase: string; label: string; sessionDate: string };
  snapshot: MarketBriefSnapshot;
};

export function parseSnapshotPayload(raw: string): MarketBriefSnapshot {
  const payload = JSON.parse(raw) as Partial<MarketBriefSnapshot>;
  if (!payload || typeof payload !== "object") {
    throw new Error("snapshot payload is not an object");
  }
  if (!payload.generated_at || !payload.regime || !payload.posture || !payload.tape || !payload.macro || !payload.focus) {
    throw new Error("snapshot payload missing required sections");
  }
  return payload as MarketBriefSnapshot;
}

export function buildArtifact(snapshot: MarketBriefSnapshot, now = new Date()): StockMarketBriefArtifact {
  return {
    artifact_version: 1,
    generated_at: now.toISOString(),
    source: "cortana-external",
    session: getMarketSessionInfo(now),
    snapshot,
  };
}

export function collectExternalSnapshot(): MarketBriefSnapshot {
  const result = spawnSync("uv", ["run", "python", "market_brief_snapshot.py"], {
    cwd: EXTERNAL_BACKTESTER_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error((result.stderr || result.stdout || "market brief snapshot failed").trim());
  }
  return parseSnapshotPayload((result.stdout || "").trim());
}

export function writeArtifact(payload: StockMarketBriefArtifact, artifactPath = DEFAULT_ARTIFACT_PATH): void {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main(): void {
  const snapshot = collectExternalSnapshot();
  const artifact = buildArtifact(snapshot);
  writeArtifact(artifact);
  process.stdout.write(`${JSON.stringify({ ok: true, path: DEFAULT_ARTIFACT_PATH, generated_at: artifact.generated_at })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
