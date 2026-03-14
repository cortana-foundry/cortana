import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawnSync: spawnSyncMock,
}));

describe("tsx-runner", () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it("uses the current node binary with --import tsx instead of relying on PATH", async () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: "ok\n", stderr: "", error: undefined });

    const { buildTsxInvocation, runTsxScript } = await import("../../tools/council/tsx-runner");
    const invocation = buildTsxInvocation("/tmp/script.ts", ["--flag", "value"]);

    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args).toEqual(["--import", "tsx", "/tmp/script.ts", "--flag", "value"]);

    const output = runTsxScript("/tmp/script.ts", ["--flag", "value"]);
    expect(output).toBe("ok");
    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.execPath,
      ["--import", "tsx", "/tmp/script.ts", "--flag", "value"],
      { encoding: "utf8" },
    );
  });

  it("surfaces spawn errors instead of collapsing them to command failed", async () => {
    spawnSyncMock.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn tsx ENOENT"),
    });

    const { runTsxScript } = await import("../../tools/council/tsx-runner");

    expect(() => runTsxScript("/tmp/script.ts", [])).toThrow(
      "Failed to launch tsx script '/tmp/script.ts': spawn tsx ENOENT",
    );
  });
});
