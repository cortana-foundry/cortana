import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildArtifact, parseSnapshotPayload, writeArtifact } from "../../tools/market-intel/stock-market-brief-collect.ts";

describe("stock market brief collector", () => {
  it("parses the external snapshot payload", () => {
    const raw = JSON.stringify({
      generated_at: "2026-03-31T12:00:00Z",
      status: "ok",
      regime: {
        label: "correction",
        display: "CORRECTION",
        position_sizing_pct: 0,
        distribution_days: 7,
        regime_score: -7,
        notes: "Stay defensive.",
        status: "ok",
        data_source: "schwab",
      },
      posture: { action: "NO_BUY", reason: "Stay defensive." },
      macro: { state: "watch", summary_line: "Polymarket mixed." },
      tape: { summary_line: "SPY weak.", risk_tone: "defensive", primary_source: "schwab", symbols: [] },
      focus: { symbols: ["MSFT", "META"] },
    });

    const payload = parseSnapshotPayload(raw);
    expect(payload.regime.display).toBe("CORRECTION");
    expect(payload.posture.action).toBe("NO_BUY");
  });

  it("builds an artifact with session metadata", () => {
    const artifact = buildArtifact(
      {
        generated_at: "2026-03-31T12:00:00Z",
        status: "ok",
        regime: {
          label: "correction",
          display: "CORRECTION",
          position_sizing_pct: 0,
          distribution_days: 7,
          regime_score: -7,
          notes: "Stay defensive.",
          status: "ok",
          data_source: "schwab",
        },
        posture: { action: "NO_BUY", reason: "Stay defensive." },
        macro: { state: "watch", summary_line: "Polymarket mixed." },
        tape: { summary_line: "SPY weak.", risk_tone: "defensive", primary_source: "schwab", symbols: [] },
        focus: { symbols: ["MSFT", "META"] },
      },
      new Date("2026-03-31T11:55:00Z"),
    );

    expect(artifact.session.phase).toBe("PREMARKET");
    expect(artifact.snapshot.focus.symbols).toEqual(["MSFT", "META"]);
  });

  it("writes the artifact to disk", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-brief-"));
    const artifactPath = path.join(tempDir, "brief.json");
    const artifact = buildArtifact(
      {
        generated_at: "2026-03-31T12:00:00Z",
        status: "ok",
        regime: {
          label: "correction",
          display: "CORRECTION",
          position_sizing_pct: 0,
          distribution_days: 7,
          regime_score: -7,
          notes: "Stay defensive.",
          status: "ok",
          data_source: "schwab",
        },
        posture: { action: "NO_BUY", reason: "Stay defensive." },
        macro: { state: "watch", summary_line: "Polymarket mixed." },
        tape: { summary_line: "SPY weak.", risk_tone: "defensive", primary_source: "schwab", symbols: [] },
        focus: { symbols: ["MSFT", "META"] },
      },
      new Date("2026-03-31T11:55:00Z"),
    );

    writeArtifact(artifact, artifactPath);
    const saved = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { session: { phase: string } };
    expect(saved.session.phase).toBe("PREMARKET");
  });
});
