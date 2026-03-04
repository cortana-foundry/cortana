import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushModuleSideEffects, importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

const spawnSync = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());
const accessSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ spawnSync }));
vi.mock("fs", () => ({
  default: {
    existsSync,
    accessSync,
    constants: { X_OK: 1 },
  },
}));

beforeEach(() => {
  spawnSync.mockReset();
  existsSync.mockReset();
  accessSync.mockReset();
  existsSync.mockReturnValue(true);
  accessSync.mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetProcess();
});

describe("log-heartbeat-decision", () => {
  it("maps extended heartbeat taxonomy and normalizes outcome", async () => {
    const exitSpy = mockExit();
    setArgv(["feedback_pipeline", "warning", "pipeline lag", "0.7", "{}"]);
    spawnSync.mockReturnValue({ status: 0 } as any);

    await importFresh("../../tools/log-heartbeat-decision.ts");
    await flushModuleSideEffects();

    const args = spawnSync.mock.calls[0]?.[1] ?? [];
    expect(args[1]).toBe("email_triage");
    expect(args[2]).toBe("heartbeat_email_triage");
    expect(args[3]).toBe("fail");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("supports task_board alias", async () => {
    const exitSpy = mockExit();
    setArgv(["task_board", "ok", "healthy", "0.9", "{}"]);
    spawnSync.mockReturnValue({ status: 0 } as any);

    await importFresh("../../tools/log-heartbeat-decision.ts");
    await flushModuleSideEffects();

    const args = spawnSync.mock.calls[0]?.[1] ?? [];
    expect(args[1]).toBe("task_execution");
    expect(args[3]).toBe("success");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
