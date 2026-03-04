import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("task-board state-enforcer shell wrapper", () => {
  it("exists at the documented path", () => {
    expect(existsSync("tools/task-board/state-enforcer.sh")).toBe(true);
  });

  it("forwards execution to the TS implementation", () => {
    const proc = spawnSync("bash", ["tools/task-board/state-enforcer.sh", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    // state-enforcer may return non-zero for --help/usage depending on CLI path,
    // but the wrapper contract is that it forwards to the TS implementation.
    expect(proc.status).not.toBeNull();
    expect(`${proc.stdout}${proc.stderr}`).toContain("spawn-start");
  });
});
