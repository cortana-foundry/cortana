import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushModuleSideEffects, captureConsole, importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

const runPsql = vi.hoisted(() => vi.fn());
vi.mock("../../tools/lib/db.js", () => ({
  runPsql,
}));

beforeEach(() => {
  runPsql.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetProcess();
});

describe("risk-score", () => {
  it("requires task-json", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    setArgv([]);

    await importFresh("../../tools/governor/risk_score.ts");
    await flushModuleSideEffects();
    expect(consoleCapture.errors.join(" ")).toContain("--task-json is required");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("denies unknown action types when policy says so", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    const task = { id: 1, metadata: { action_type: "mystery" } };
    setArgv(["--task-json", JSON.stringify(task)]);

    await importFresh("../../tools/governor/risk_score.ts");
    await flushModuleSideEffects();
    const payload = JSON.parse(consoleCapture.logs.join("\n"));
    expect(payload.decision).toBe("denied");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("approves low-risk internal writes", async () => {
    const exitSpy = mockExit();
    const consoleCapture = captureConsole();
    const task = { id: 2, metadata: { action_type: "internal-write" } };
    setArgv(["--task-json", JSON.stringify(task)]);

    await importFresh("../../tools/governor/risk_score.ts");
    await flushModuleSideEffects();
    const payload = JSON.parse(consoleCapture.logs.join("\n"));
    expect(payload.decision).toBe("approved");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
