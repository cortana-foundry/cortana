import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, flushModuleSideEffects, importFresh, mockExit, resetProcess, setArgv } from "../test-utils";

const spawnSync = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawnSync,
}));

vi.mock("../../tools/lib/paths.js", () => ({
  resolveRepoPath: () => "/repo",
}));

describe("market-intel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawnSync.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetProcess();
  });

  async function runTicker() {
    const exitSpy = mockExit();
    const consoleSpy = captureConsole();
    setArgv(["--ticker", "TSLA"]);
    await importFresh("../../tools/market-intel/market-intel.ts");
    await flushModuleSideEffects();
    consoleSpy.restore();
    return { exitSpy, logs: consoleSpy.logs, errors: consoleSpy.errors, warns: consoleSpy.warns };
  }

  it("invokes stock-analysis via npx tsx src/stock_analysis/main.ts", async () => {
    spawnSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "npx") {
        return {
          status: 0,
          stdout: JSON.stringify({ price: 201, change_percent: 1.2, signal: "neutral" }),
          stderr: "",
        } as any;
      }
      if (cmd === "bird") {
        return { status: 1, stdout: "", stderr: "" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    });

    fetchMock.mockResolvedValue({
      text: async () => "Date,Open,High,Low,Close,Volume\n2024-01-02,1,2,0.5,3,100",
    });

    await runTicker();

    const npxCall = spawnSync.mock.calls.find((call) => call[0] === "npx");
    expect(npxCall).toBeTruthy();
    expect(npxCall?.[1]).toEqual(["tsx", "src/stock_analysis/main.ts", "analyze", "TSLA", "--json"]);
    const uvCall = spawnSync.mock.calls.find((call) => call[0] === "uv");
    expect(uvCall).toBeUndefined();
  });

  it("parses valid JSON stdout from stock-analysis", async () => {
    spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "npx") {
        return {
          status: 0,
          stdout: JSON.stringify({ price: 201, change_percent: 1.2, signal: "neutral" }),
          stderr: "",
        } as any;
      }
      if (cmd === "bird") {
        return { status: 1, stdout: "", stderr: "" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    });

    fetchMock.mockResolvedValue({
      text: async () => "Date,Open,High,Low,Close,Volume\n2024-01-02,1,2,0.5,3,100",
    });

    const { exitSpy, logs } = await runTicker();
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logs.join("\n")).toContain("Price: $201 (1.2%) [neutral]");
  });

  it("throws when stock-analysis exits non-zero", async () => {
    spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "npx") {
        return { status: 1, stdout: "", stderr: "boom" } as any;
      }
      return { status: 0, stdout: "", stderr: "" } as any;
    });

    const { exitSpy, logs } = await runTicker();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logs.join("\n")).toContain("stock-analysis failed: boom");
  });
});
