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

    expect(proc.status).toBe(0);
    expect(`${proc.stdout}${proc.stderr}`).toContain("spawn-start");
  });
});
