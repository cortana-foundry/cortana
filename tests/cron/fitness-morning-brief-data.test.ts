import { describe, expect, it } from "vitest";
import {
  buildReadinessSupport,
  buildMorningTrainingRecommendation,
  readinessEmoji,
  whoopRecoveryBandFromScore,
} from "../../tools/fitness/morning-brief-data.ts";

describe("fitness morning brief readiness mapping", () => {
  it("maps whoop recovery score to whoop-style band and emoji", () => {
    expect(whoopRecoveryBandFromScore(80)).toBe("green");
    expect(whoopRecoveryBandFromScore(58)).toBe("yellow");
    expect(whoopRecoveryBandFromScore(25)).toBe("red");
    expect(whoopRecoveryBandFromScore(null)).toBe("unknown");

    expect(readinessEmoji("green")).toBe("🟢");
    expect(readinessEmoji("yellow")).toBe("🟡");
    expect(readinessEmoji("red")).toBe("🔴");
    expect(readinessEmoji("unknown")).toBe("⚪");
  });

  it("keeps recommendation conservative when stale, and controlled when yellow", () => {
    const stale = buildMorningTrainingRecommendation({
      readinessBand: "yellow",
      sleepPerformance: 82,
      isStale: true,
    });
    expect(stale.mode).toBe("zone2_mobility");

    const yellow = buildMorningTrainingRecommendation({
      readinessBand: "yellow",
      sleepPerformance: 82,
      isStale: false,
    });
    expect(yellow.mode).toBe("controlled_train");
  });

  it("surfaces hrv and rhr support signals from recent recovery entries", () => {
    const support = buildReadinessSupport([
      {
        date: "2026-03-18",
        createdAt: "2026-03-18T10:00:00Z",
        recoveryScore: 58,
        hrv: 102,
        rhr: 50,
      },
      {
        date: "2026-03-17",
        createdAt: "2026-03-17T10:00:00Z",
        recoveryScore: 62,
        hrv: 98,
        rhr: 51,
      },
      {
        date: "2026-03-16",
        createdAt: "2026-03-16T10:00:00Z",
        recoveryScore: 67,
        hrv: 97,
        rhr: 52,
      },
    ]);

    expect(support.hrv_latest).toBe(102);
    expect(support.hrv_baseline7).toBe(97.5);
    expect(support.hrv_delta_pct).toBeCloseTo(4.62, 2);
    expect(support.rhr_latest).toBe(50);
    expect(support.rhr_baseline7).toBe(51.5);
    expect(support.rhr_delta).toBe(-1.5);
  });
});
