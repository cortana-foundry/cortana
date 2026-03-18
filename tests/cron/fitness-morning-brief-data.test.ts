import { describe, expect, it } from "vitest";
import {
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
});
