import { describe, expect, it } from "vitest";

import {
  decideSingleFlight,
  isActiveSubagent,
  isHeavyCodingText,
  parseArgs,
} from "../../tools/covenant/heavy-coding-singleflight";

describe("heavy coding single-flight", () => {
  it("classifies heavy coding text", () => {
    expect(isHeavyCodingText("Implement fix and open PR")).toBe(true);
    expect(isHeavyCodingText("calendar sync and reminders only")).toBe(false);
  });

  it("filters only active subagent sessions", () => {
    expect(isActiveSubagent({ key: "agent:x:subagent:1", status: "running" })).toBe(true);
    expect(isActiveSubagent({ key: "agent:x:subagent:1", status: "completed" })).toBe(false);
    expect(isActiveSubagent({ key: "agent:x:main", status: "running" })).toBe(false);
  });

  it("blocks when cap reached and queue policy is deny", () => {
    const decision = decideSingleFlight(
      [
        { key: "agent:a:subagent:1", status: "running", mission: "Implement feature in codex" },
        { key: "agent:a:subagent:2", status: "running", mission: "Refactor tests" },
      ],
      {
        maxConcurrent: 2,
        queuePolicy: "deny",
        requestLabel: "subagent-3",
        requestMission: "Build single-flight limiter",
        backoffMs: 45000,
      }
    );

    expect(decision.blocked).toBe(true);
    expect(decision.ok).toBe(false);
    expect(decision.backoffMs).toBe(45000);
    expect(decision.reason).toContain("single_flight_blocked");
  });

  it("allows queue with backoff when saturated and policy=allow", () => {
    const decision = decideSingleFlight(
      [{ key: "agent:a:subagent:1", status: "running", mission: "Implement API in codex" }],
      {
        maxConcurrent: 1,
        queuePolicy: "allow",
        requestLabel: "worker-2",
        requestMission: "Implement guardrail",
        backoffMs: 15000,
      }
    );

    expect(decision.ok).toBe(true);
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBe("single_flight_saturated_queue_allowed");
    expect(decision.backoffMs).toBe(15000);
  });

  it("parseArgs enforces sane defaults", () => {
    const parsed = parseArgs(["--max-concurrent", "0", "--backoff-ms", "-1"]);
    expect(parsed.maxConcurrent).toBe(1);
    expect(parsed.backoffMs).toBe(0);
    expect(parsed.queuePolicy).toBe("deny");
  });
});
