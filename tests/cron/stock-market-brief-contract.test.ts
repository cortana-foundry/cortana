import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("stock market brief cron contract", () => {
  it("uses a collect-and-summarize split with the artifact as source of truth", () => {
    const jobsPath = path.resolve("config/cron/jobs.json");
    const raw = fs.readFileSync(jobsPath, "utf8");
    const json = JSON.parse(raw) as {
      jobs: Array<{
        id?: string;
        schedule?: { expr?: string };
        payload?: { message?: string };
      }>;
    };

    const collectJob = json.jobs.find((entry) => entry.id === "stock-market-brief-collect-20260331");
    expect(collectJob?.schedule?.expr).toBe("45 7 * * 1-5");
    expect(String(collectJob?.payload?.message ?? "")).toContain("stock-market-brief-collect.ts");
    expect(String(collectJob?.payload?.message ?? "")).toContain("Do not use the message tool");

    const summaryJob = json.jobs.find((entry) => entry.id === "a86ca3f9-38af-4672-ba3f-1911352f0319");
    const message = String(summaryJob?.payload?.message ?? "");
    expect(message).toContain("/tmp/cron-stock-market-brief.json");
    expect(message).toContain("stock-market-brief-notify.ts");
    expect(message).toContain("If stdout is exactly NO_REPLY: return exactly NO_REPLY");
    expect(message).toContain("Do not send routine daily commentary");
    expect(message).toContain("Do not invent market details");
    expect(message).not.toContain("Beginner Corner");
    expect(message).not.toContain("finance insights");
  });
});
