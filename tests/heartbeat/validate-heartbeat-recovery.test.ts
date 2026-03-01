import { describe, expect, it } from "vitest";
import { defaultHeartbeatState, validateHeartbeatState } from "../../tools/lib/heartbeat-schema.js";

describe("heartbeat recovery semantics", () => {
  it("fails on corrupt state and accepts default fallback", () => {
    const now = Date.now();
    expect(() => validateHeartbeatState("{bad-json" as any, now)).toThrow();
    const fallback = defaultHeartbeatState(now);
    expect(() => validateHeartbeatState(fallback, now)).not.toThrow();
  });
});
