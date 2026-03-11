import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, captureStdout, flushModuleSideEffects, importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ spawnSync }));

describe("task-board stale-detector", () => {
  beforeEach(() => {
    spawnSync.mockReset();
    resetProcess();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProcess();
  });

  it("re-emits compact valid json for downstream consumers", async () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: '{\n  "ok": true,\n  "actions": {\n    "stale_pending_flagged_count": 1\n  }\n}\n',
      stderr: "",
    });

    setArgv([]);
    const exitSpy = mockExit();
    const stdout = captureStdout();
    await importFresh("../../tools/task-board/stale-detector.ts");
    await flushModuleSideEffects();
    stdout.restore();

    const parsed = JSON.parse(stdout.writes.join(""));
    expect(parsed).toMatchObject({ ok: true, actions: { stale_pending_flagged_count: 1 } });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("fails loudly on invalid json instead of leaking broken output", async () => {
    spawnSync.mockReturnValue({
      status: 0,
      stdout: "not-json\n",
      stderr: "",
    });

    setArgv([]);
    const exitSpy = mockExit();
    const consoleSpy = captureConsole();
    await importFresh("../../tools/task-board/stale-detector.ts");
    await flushModuleSideEffects();
    consoleSpy.restore();

    expect(consoleSpy.errors.join("\n")).toContain("stale-detector: invalid JSON output");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
