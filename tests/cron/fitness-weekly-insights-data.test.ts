import path from "node:path";
import { describe, expect, it } from "vitest";
import { weeklyPaths } from "../../tools/fitness/weekly-insights-data.ts";

describe("fitness weekly insights persistence paths", () => {
  it("returns sandbox-safe weekly path and repo mirror path", () => {
    const paths = weeklyPaths("2026-W12", "cron-fitness");

    expect(paths.sandboxFilePath).toContain(path.join(".openclaw", "workspaces", "cron-fitness"));
    expect(paths.sandboxFilePath).toContain(path.join("memory", "fitness", "weekly", "2026-W12.md"));
    expect(paths.repoFilePath).toBe("/Users/hd/Developer/cortana/memory/fitness/weekly/2026-W12.md");
  });
});
