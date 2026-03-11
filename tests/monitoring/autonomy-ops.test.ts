import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, flushModuleSideEffects, mockExit, resetProcess, setArgv, importFresh } from "../test-utils";

const collectAutonomyStatus = vi.hoisted(() => vi.fn());
const buildRolloutSummary = vi.hoisted(() => vi.fn());
const runAutonomyDrill = vi.hoisted(() => vi.fn());

vi.mock("../../tools/monitoring/autonomy-status.ts", () => ({ collectAutonomyStatus }));
vi.mock("../../tools/monitoring/autonomy-rollout.ts", () => ({ buildRolloutSummary }));
vi.mock("../../tools/monitoring/autonomy-drill.ts", () => ({ runAutonomyDrill }));

describe("autonomy-ops", () => {
  beforeEach(() => {
    resetProcess();
    collectAutonomyStatus.mockReset();
    buildRolloutSummary.mockReset();
    runAutonomyDrill.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProcess();
  });

  it("stays quiet when operator surface is live and healthy", async () => {
    const consoleSpy = captureConsole();
    const exitSpy = mockExit();
    collectAutonomyStatus.mockReturnValue({
      posture: "balanced",
      autoFixedItems: [], deferredItems: [], waitingOnHuman: [],
      autoRemediated: 0, escalated: 0, needsHuman: 0, actionable: 0, suppressed: 2,
    });
    buildRolloutSummary.mockReturnValue({ status: "live", reasons: [] });
    runAutonomyDrill.mockReturnValue({ status: "live", familyCriticalFailures: 0, scenarios: [] });

    setArgv([]);
    await importFresh("../../tools/monitoring/autonomy-ops.ts");
    await flushModuleSideEffects();
    consoleSpy.restore();

    expect(consoleSpy.logs).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("reports watch/attention state with one clean operator surface", async () => {
    const consoleSpy = captureConsole();
    const exitSpy = mockExit();
    collectAutonomyStatus.mockReturnValue({
      posture: "balanced",
      autoFixedItems: ["gateway"],
      deferredItems: ["channel:escalate"],
      waitingOnHuman: ["1 escalated check(s)"],
      autoRemediated: 1,
      escalated: 1,
      needsHuman: 1,
      actionable: 0,
      suppressed: 1,
    });
    buildRolloutSummary.mockReturnValue({ status: "attention", reasons: ["1 escalated check(s)"] });
    runAutonomyDrill.mockReturnValue({
      status: "live",
      familyCriticalFailures: 0,
      scenarios: [{ scenario: "family_critical", lane: "family_critical", passed: true }],
    });

    setArgv([]);
    await importFresh("../../tools/monitoring/autonomy-ops.ts");
    await flushModuleSideEffects();
    consoleSpy.restore();

    const output = consoleSpy.logs.join("\n");
    expect(output).toContain("🧭 Cortana Operator Surface");
    expect(output).toContain("operator state: attention");
    expect(output).toContain("auto-fixed: gateway");
    expect(output).toContain("degraded: channel:escalate");
    expect(output).toContain("waiting on Hamel: 1 escalated check(s)");
    expect(output).toContain("family-critical tracked: family_critical");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
