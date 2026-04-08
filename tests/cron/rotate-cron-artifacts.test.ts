import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureConsole, flushModuleSideEffects, importFresh, resetProcess } from "../test-utils";

const existsSync = vi.hoisted(() => vi.fn(() => false));
const readdirSync = vi.hoisted(() => vi.fn(() => []));
const statSync = vi.hoisted(() => vi.fn());
const writeFileSync = vi.hoisted(() => vi.fn());
const unlinkSync = vi.hoisted(() => vi.fn());
const spawnSync = vi.hoisted(() => vi.fn(() => ({ status: 0, stdout: "" })));
const withPostgresPath = vi.hoisted(() => vi.fn((env: NodeJS.ProcessEnv) => env));
const exitSpy = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  default: {
    existsSync,
    readdirSync,
    statSync,
    writeFileSync,
    unlinkSync,
  },
}));

vi.mock("node:child_process", () => ({
  spawnSync,
}));

vi.mock("../../tools/lib/db.js", () => ({
  withPostgresPath,
}));

describe("rotate-cron-artifacts", () => {
  beforeEach(() => {
    existsSync.mockReset();
    readdirSync.mockReset();
    statSync.mockReset();
    writeFileSync.mockReset();
    unlinkSync.mockReset();
    spawnSync.mockReset();
    withPostgresPath.mockReset();

    existsSync.mockReturnValue(false);
    readdirSync.mockReturnValue([]);
    spawnSync.mockReturnValue({ status: 0, stdout: "" });
    withPostgresPath.mockImplementation((env: NodeJS.ProcessEnv) => env);
    vi.stubGlobal("process", { ...process, exit: exitSpy });
    exitSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetProcess();
  });

  it("loads withPostgresPath and exits cleanly when the run directory is missing", async () => {
    const consoleSpy = captureConsole();
    await importFresh("../../tools/cron/rotate-cron-artifacts.ts");
    await flushModuleSideEffects();
    consoleSpy.restore();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(withPostgresPath).toHaveBeenCalled();
    expect(spawnSync).toHaveBeenCalledWith(
      "psql",
      expect.any(Array),
      expect.objectContaining({ env: expect.any(Object), stdio: "ignore" }),
    );
  });
});
