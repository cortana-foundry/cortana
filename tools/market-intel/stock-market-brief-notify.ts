#!/usr/bin/env npx tsx

import fs from "node:fs";

const DEFAULT_ARTIFACT_PATH = "/tmp/cron-stock-market-brief.json";
const FRESHNESS_MS = 3 * 60 * 60 * 1000;

type Artifact = {
  generated_at?: string;
  session?: { phase?: string };
  snapshot?: {
    status?: string;
    degraded_status?: string;
    outcome_class?: string;
    regime?: { display?: string; position_sizing_pct?: number };
    posture?: { action?: string; reason?: string };
    warnings?: string[];
  };
};

export type AlertDecision = {
  send: boolean;
  reason: string;
  message: string;
};

export function evaluateArtifact(
  artifact: Artifact | null,
  now: Date = new Date(),
  artifactPath = DEFAULT_ARTIFACT_PATH,
): AlertDecision {
  if (!artifact) {
    return {
      send: true,
      reason: "artifact_missing",
      message: `⚠️ Markets - Stock Market Brief\nSnapshot artifact missing: ${artifactPath}`,
    };
  }

  const generatedAtRaw = artifact.generated_at;
  const generatedAt = generatedAtRaw ? Date.parse(generatedAtRaw) : Number.NaN;
  if (!Number.isFinite(generatedAt)) {
    return {
      send: true,
      reason: "artifact_invalid",
      message: "⚠️ Markets - Stock Market Brief\nSnapshot artifact invalid: generated_at missing/invalid",
    };
  }

  const ageMs = now.getTime() - generatedAt;
  if (ageMs > FRESHNESS_MS) {
    return {
      send: true,
      reason: "artifact_stale",
      message: `⚠️ Markets - Stock Market Brief\nSnapshot stale (${Math.floor(ageMs / 60000)}m old)`,
    };
  }

  const status = String(artifact.snapshot?.status ?? "").toLowerCase();
  const degradedStatus = String(artifact.snapshot?.degraded_status ?? "").toLowerCase();
  if (status === "error" || degradedStatus === "degraded_risky") {
    const session = String(artifact.session?.phase ?? "unknown").toUpperCase();
    const regime = String(artifact.snapshot?.regime?.display ?? "unknown").toUpperCase();
    const size = Number(artifact.snapshot?.regime?.position_sizing_pct ?? 0);
    const action = String(artifact.snapshot?.posture?.action ?? "HOLD").toUpperCase();
    const reason = String(artifact.snapshot?.posture?.reason ?? "snapshot degraded").trim();
    const warning = Array.isArray(artifact.snapshot?.warnings) && artifact.snapshot?.warnings?.length
      ? ` | warnings: ${artifact.snapshot?.warnings?.slice(0, 2).join(", ")}`
      : "";

    return {
      send: true,
      reason: "degraded_risky",
      message: `⚠️ Markets - Stock Market Brief\n${session} | ${regime} | Size ${size}%\nPosture: ${action}. ${reason}${warning}`,
    };
  }

  return { send: false, reason: "healthy_or_safe", message: "NO_REPLY" };
}

export function readArtifact(artifactPath = DEFAULT_ARTIFACT_PATH): Artifact | null {
  if (!fs.existsSync(artifactPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(artifactPath, "utf8")) as Artifact;
  } catch {
    return { generated_at: "", snapshot: { status: "error" } };
  }
}

function main(): void {
  const artifactPath = process.env.STOCK_MARKET_BRIEF_ARTIFACT || DEFAULT_ARTIFACT_PATH;
  const decision = evaluateArtifact(readArtifact(artifactPath), new Date(), artifactPath);
  process.stdout.write(`${decision.send ? decision.message : "NO_REPLY"}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
