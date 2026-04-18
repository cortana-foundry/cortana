import { describe, expect, it } from "vitest";

import { evaluateArtifact } from "../../tools/market-intel/stock-market-brief-notify.ts";

describe("stock market brief notify", () => {
  const now = new Date("2026-04-18T12:00:00Z");

  it("stays silent on healthy/degraded-safe artifacts", () => {
    const decision = evaluateArtifact(
      {
        generated_at: "2026-04-18T11:30:00Z",
        session: { phase: "CLOSED" },
        snapshot: {
          status: "degraded",
          degraded_status: "degraded_safe",
          regime: { display: "CORRECTION", position_sizing_pct: 0 },
          posture: { action: "NO_BUY", reason: "stay defensive" },
        },
      },
      now,
    );

    expect(decision.send).toBe(false);
    expect(decision.message).toBe("NO_REPLY");
  });

  it("alerts when artifact is stale", () => {
    const decision = evaluateArtifact(
      {
        generated_at: "2026-04-18T07:00:00Z",
        snapshot: { status: "ok", degraded_status: "healthy" },
      },
      now,
      "/tmp/cron-stock-market-brief.json",
    );

    expect(decision.send).toBe(true);
    expect(decision.reason).toBe("artifact_stale");
    expect(decision.message).toContain("Snapshot stale");
  });

  it("alerts when snapshot is degraded_risky", () => {
    const decision = evaluateArtifact(
      {
        generated_at: "2026-04-18T11:45:00Z",
        session: { phase: "OPEN" },
        snapshot: {
          status: "degraded",
          degraded_status: "degraded_risky",
          regime: { display: "CORRECTION", position_sizing_pct: 0 },
          posture: { action: "NO_BUY", reason: "market data unreliable" },
          warnings: ["tape_fetch_failed"],
        },
      },
      now,
    );

    expect(decision.send).toBe(true);
    expect(decision.reason).toBe("degraded_risky");
    expect(decision.message).toContain("OPEN | CORRECTION | Size 0%");
    expect(decision.message).toContain("warnings: tape_fetch_failed");
  });
});
