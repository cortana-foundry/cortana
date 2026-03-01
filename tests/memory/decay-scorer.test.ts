import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, importFresh, resetProcess, setArgv, useFixedTime } from "../test-utils";

const fsMock = vi.hoisted(() => ({ readFileSync: vi.fn() }));
const lancedbMock = vi.hoisted(() => ({ connect: vi.fn() }));

vi.mock("fs", () => ({ default: fsMock, ...fsMock }));
vi.mock("lancedb", () => ({ default: lancedbMock }));

beforeEach(() => {
  fsMock.readFileSync.mockReset();
  lancedbMock.connect.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetProcess();
});

describe("decay-scorer", () => {
  it("prints help and exits", async () => {
    const consoleCapture = captureConsole();
    setArgv(["--help"]);

    const mod = await importFresh("../../tools/memory/decay-scorer.ts");
    await expect(mod.runCli()).resolves.toBe(0);
    expect(consoleCapture.logs.join(" ")).toContain("usage: decay-scorer.ts");
  });

  it("requires a query", async () => {
    const consoleCapture = captureConsole();
    setArgv(["--top-k", "2"]);

    const mod = await importFresh("../../tools/memory/decay-scorer.ts");
    await expect(mod.runCli()).resolves.toBe(2);
    expect(consoleCapture.errors.join(" ")).toContain("--query is required");
  });

  it("returns decay-ranked results", async () => {
    useFixedTime("2025-01-01T00:00:00Z");
    setArgv(["--query", "hello", "--top-k", "1", "--candidate-k", "2"]);

    fsMock.readFileSync.mockReturnValue(
      JSON.stringify({ plugins: { entries: { "memory-lancedb": { config: { embedding: { apiKey: "key" } } } } } })
    );

    const rows = [
      { id: 1, _distance: 0.1, createdAt: Date.now(), access_count: 0 },
      { id: 2, _distance: 0.9, createdAt: Date.now(), access_count: 0 },
    ];

    lancedbMock.connect.mockResolvedValue({
      openTable: vi.fn(async () => ({
        vectorSearch: vi.fn(() => ({
          limit: () => ({ toArray: async () => rows }),
        })),
      })),
    });

    const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }) }));
    vi.stubGlobal("fetch", fetchSpy as any);

    const consoleCapture = captureConsole();
    const mod = await importFresh("../../tools/memory/decay-scorer.ts");
    await expect(mod.runCli()).resolves.toBe(0);

    const payload = JSON.parse(consoleCapture.logs.join("\n"));
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].id).toBe(1);
  });
});
