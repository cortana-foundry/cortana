import { describe, expect, it, vi } from "vitest";

const getActiveVacationWindow = vi.hoisted(() => vi.fn());
const getLatestReadinessRun = vi.hoisted(() => vi.fn());
const getVacationWindow = vi.hoisted(() => vi.fn());
const createVacationWindow = vi.hoisted(() => vi.fn());
const updateVacationWindow = vi.hoisted(() => vi.fn());
const startVacationRun = vi.hoisted(() => vi.fn());
const finishVacationRun = vi.hoisted(() => vi.fn());
const setRuntimeCronJobsEnabled = vi.hoisted(() => vi.fn());
const writeVacationMirror = vi.hoisted(() => vi.fn());
const archiveVacationMirror = vi.hoisted(() => vi.fn());
const clearVacationMirror = vi.hoisted(() => vi.fn());

vi.mock("../../tools/vacation/vacation-state.ts", () => ({
  getActiveVacationWindow,
  getLatestReadinessRun,
  getVacationWindow,
  createVacationWindow,
  updateVacationWindow,
  startVacationRun,
  finishVacationRun,
  setRuntimeCronJobsEnabled,
  writeVacationMirror,
  archiveVacationMirror,
  clearVacationMirror,
  buildVacationMirror: vi.fn(() => ({ enabled: true, windowId: 1 })),
}));

describe("vacation state machine", () => {
  it("rejects enable when the latest readiness run is stale", async () => {
    getLatestReadinessRun.mockReturnValue({
      id: 1,
      readiness_outcome: "pass",
      completed_at: "2026-04-10T00:00:00.000Z",
    });
    getActiveVacationWindow.mockReturnValue(null);
    const { enableVacationMode } = await import("../../tools/vacation/vacation-state-machine.ts");
    expect(() => enableVacationMode({
      config: {
        readinessFreshnessHours: 6,
        timezone: "America/New_York",
        pausedJobIds: ["af9e1570-3ba2-4d10-a807-91cdfc2df18b"],
      } as any,
    })).toThrow(/stale/);
  });

  it("restores paused jobs on disable", async () => {
    getActiveVacationWindow.mockReturnValue({
      id: 1,
      label: "vacation-2026-04-20",
      state_snapshot: {},
    });
    startVacationRun.mockReturnValue({ id: 4 });
    setRuntimeCronJobsEnabled.mockReturnValue(["af9e1570-3ba2-4d10-a807-91cdfc2df18b"]);
    updateVacationWindow.mockReturnValue({ id: 1, label: "vacation-2026-04-20" });
    finishVacationRun.mockReturnValue({ id: 4 });
    archiveVacationMirror.mockReturnValue("/tmp/vacation-mode.json.bak");
    const { disableVacationMode } = await import("../../tools/vacation/vacation-state-machine.ts");
    const result = disableVacationMode({
      config: { pausedJobIds: ["af9e1570-3ba2-4d10-a807-91cdfc2df18b"] } as any,
      reason: "manual",
    });
    expect(result.restoredJobIds).toEqual(["af9e1570-3ba2-4d10-a807-91cdfc2df18b"]);
  });
});
