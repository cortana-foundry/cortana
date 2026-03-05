import { describe, expect, it } from "vitest";
import { buildBrief, parseCalendar, recommendationFromRecovery, recommendationFromTasks, type BriefData } from "../../tools/briefing/daily-command-brief.ts";

describe("daily command brief", () => {
  it("parses plain calendar output deterministically", () => {
    const parsed = parseCalendar("2026-03-05\n8:30 AM Team Standup\n1:00 PM Mortgage calls\n\n");
    expect(parsed).toEqual(["8:30 AM Team Standup", "1:00 PM Mortgage calls"]);
  });

  it("generates explicit recommendation tiers from recovery", () => {
    expect(recommendationFromRecovery(80)).toContain("Green recovery");
    expect(recommendationFromRecovery(50)).toContain("Yellow recovery");
    expect(recommendationFromRecovery(20)).toContain("Red recovery");
  });

  it("prioritizes overdue task recommendation", () => {
    expect(recommendationFromTasks(2, 0)).toContain("Clear 2 overdue");
    expect(recommendationFromTasks(0, 3)).toContain("Front-load due-today items (3)");
  });

  it("renders deterministic 4-section template with recommendations", () => {
    const data: BriefData = {
      nowEt: "Wed, Mar 4, 9:00 PM",
      calendar: ["8:30 AM Standup"],
      fitness: {
        recoveryScore: 71,
        sleepPerformance: 86,
        whoopWorkoutsToday: ["Run"],
        tonalWorkoutsToday: ["volume 12000"],
        status: "ok",
      },
      market: {
        headline: "Risk-on open expected",
        bullets: ["Futures mildly green"],
        status: "ok",
      },
      tasks: {
        ready: [{ title: "Submit project draft", priority: 1, due_at: "Mar 05 11:00 AM" }],
        overdueCount: 0,
        dueTodayCount: 1,
        status: "ok",
      },
    };

    const out = buildBrief(data);
    expect(out).toContain("1) 📅 Calendar Command Window");
    expect(out).toContain("2) 🏋️ Recovery & Fitness");
    expect(out).toContain("3) 📈 Market Intelligence");
    expect(out).toContain("4) ✅ Task Board Execution");
    expect((out.match(/Recommendation:/g) || []).length).toBe(4);
  });
});