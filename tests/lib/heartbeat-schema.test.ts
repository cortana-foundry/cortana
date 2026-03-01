import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_MAX_AGE_MS,
  HEARTBEAT_REQUIRED_CHECKS,
  defaultHeartbeatState,
  validateHeartbeatState,
} from "../../tools/lib/heartbeat-schema.js";

describe("heartbeat schema", () => {
  it("accepts valid state", () => {
    const now = Date.now();
    const state = defaultHeartbeatState(now);
    const parsed = validateHeartbeatState(state, now, HEARTBEAT_MAX_AGE_MS);
    expect(parsed.version).toBe(2);
    expect(Object.keys(parsed.lastChecks)).toEqual(HEARTBEAT_REQUIRED_CHECKS);
  });

  it("rejects missing required checks", () => {
    const now = Date.now();
    const state = defaultHeartbeatState(now);
    delete (state.lastChecks as any).weather;
    expect(() => validateHeartbeatState(state, now, HEARTBEAT_MAX_AGE_MS)).toThrow(/missing required check/);
  });

  it("rejects stale timestamps", () => {
    const now = Date.now();
    const state = defaultHeartbeatState(now);
    state.lastChecks.email.lastChecked = now - HEARTBEAT_MAX_AGE_MS - 1000;
    expect(() => validateHeartbeatState(state, now, HEARTBEAT_MAX_AGE_MS)).toThrow(/timestamp stale/);
  });
});
