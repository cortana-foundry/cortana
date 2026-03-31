import { describe, expect, it } from "vitest";

import { getMarketSessionInfo, getMarketStatus } from "../../skills/markets/check_market_status.ts";

describe("stock market session helper", () => {
  it("returns premarket before 9:30 ET on a trading day", () => {
    const status = getMarketSessionInfo(new Date("2026-03-31T11:55:00Z"));
    expect(status.phase).toBe("PREMARKET");
    expect(status.label).toBe("PREMARKET");
  });

  it("returns open during regular hours", () => {
    const status = getMarketSessionInfo(new Date("2026-03-31T15:00:00Z"));
    expect(status.phase).toBe("OPEN");
    expect(status.label).toBe("OPEN");
  });

  it("returns after hours after the cash close", () => {
    const status = getMarketSessionInfo(new Date("2026-03-31T21:10:00Z"));
    expect(status.phase).toBe("AFTER_HOURS");
    expect(status.label).toBe("AFTER_HOURS");
  });

  it("returns holiday and weekend closures", () => {
    expect(getMarketStatus(new Date("2026-04-03T15:00:00Z"))).toContain("Good Friday");
    expect(getMarketStatus(new Date("2026-03-28T15:00:00Z"))).toContain("Weekend");
  });

  it("marks early-close sessions explicitly", () => {
    const open = getMarketSessionInfo(new Date("2026-11-27T16:00:00Z"));
    expect(open.phase).toBe("OPEN");
    expect(open.label).toContain("EARLY CLOSE 1:00 PM ET");

    const afterHours = getMarketSessionInfo(new Date("2026-11-27T19:00:00Z"));
    expect(afterHours.phase).toBe("AFTER_HOURS");
    expect(afterHours.label).toContain("EARLY CLOSE 1:00 PM ET");
  });
});
