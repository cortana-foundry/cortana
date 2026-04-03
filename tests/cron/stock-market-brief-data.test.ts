import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildArtifact,
  MARKET_BRIEF_ARTIFACT_FAMILY,
  MARKET_BRIEF_SCHEMA_VERSION,
  parseSnapshotPayload,
  writeArtifact,
} from "../../tools/market-intel/stock-market-brief-collect.ts";

const FIXTURE_DIR = path.resolve("tests/fixtures/consumer_contracts");
const FIXTURE_PATH = (name: string) => path.join(FIXTURE_DIR, name);

function loadSnapshotFixture(name: string) {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH(name), "utf8")) as Record<string, unknown>;
}

describe("stock market brief collector", () => {
  it("parses replay fixtures from the typed consumer contract corpus", () => {
    const blocked = parseSnapshotPayload(JSON.stringify(loadSnapshotFixture("market-brief-market-gate-blocked.json")));
    const degradedSafe = parseSnapshotPayload(JSON.stringify(loadSnapshotFixture("market-brief-degraded-safe.json")));
    const degradedRisky = parseSnapshotPayload(JSON.stringify(loadSnapshotFixture("market-brief-degraded-risky.json")));

    expect(blocked.artifact_family).toBe(MARKET_BRIEF_ARTIFACT_FAMILY);
    expect(blocked.degraded_status).toBe("healthy");
    expect(blocked.outcome_class).toBe("market_gate_blocked");
    expect(blocked.regime.display).toBe("CORRECTION");
    expect(blocked.posture.action).toBe("NO_BUY");

    expect(degradedSafe.degraded_status).toBe("degraded_safe");
    expect(degradedSafe.tape.primary_source).toBe("cache");
    expect(degradedSafe.warnings).toEqual(["tape_previous_session_fallback"]);

    expect(degradedRisky.degraded_status).toBe("degraded_risky");
    expect(degradedRisky.tape.primary_source).toBe("unavailable");
    expect(degradedRisky.warnings).toEqual(["tape_fetch_failed", "polymarket_context_unavailable"]);
  });

  it("rejects payloads missing typed contract fields", () => {
    expect(() =>
      parseSnapshotPayload(
        JSON.stringify({
          generated_at: "2026-03-31T12:00:00Z",
          status: "ok",
          regime: {},
        }),
      ),
    ).toThrow("snapshot payload must be artifact_family=market_brief");
  });

  it("builds an artifact with session metadata", () => {
    const artifact = buildArtifact(
      parseSnapshotPayload(JSON.stringify(loadSnapshotFixture("market-brief-market-gate-blocked.json"))),
      new Date("2026-03-31T11:55:00Z"),
    );

    expect(artifact.session.phase).toBe("PREMARKET");
    expect(artifact.snapshot.focus.symbols).toEqual(["OXY", "GEV", "FANG"]);
  });

  it("writes the artifact to disk", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-brief-"));
    const artifactPath = path.join(tempDir, "brief.json");
    const artifact = buildArtifact(
      parseSnapshotPayload(JSON.stringify(loadSnapshotFixture("market-brief-market-gate-blocked.json"))),
      new Date("2026-03-31T11:55:00Z"),
    );

    writeArtifact(artifact, artifactPath);
    const saved = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as {
      session: { phase: string };
      snapshot: { artifact_family: string; degraded_status: string };
    };
    expect(saved.session.phase).toBe("PREMARKET");
    expect(saved.snapshot.artifact_family).toBe("market_brief");
    expect(saved.snapshot.degraded_status).toBe("healthy");
  });
});
