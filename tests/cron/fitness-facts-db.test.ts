import { describe, expect, it } from "vitest";
import { buildFitnessWindowSummarySql, buildUpsertFitnessDailySnapshotSql } from "../../tools/fitness/facts-db.ts";

describe("fitness facts db sql builders", () => {
  it("builds an upsert statement with conflict merge semantics", () => {
    const sql = buildUpsertFitnessDailySnapshotSql({
      snapshotDate: "2026-03-18",
      readinessScore: 58,
      readinessBand: "yellow",
      stepCount: 12876,
      stepSource: "cycle",
      proteinStatus: "on_target",
      raw: { note: "coach's summary" },
    });

    expect(sql).toContain("INSERT INTO cortana_fitness_daily_facts");
    expect(sql).toContain("ON CONFLICT (snapshot_date) DO UPDATE");
    expect(sql).toContain("step_count");
    expect(sql).toContain("COALESCE(EXCLUDED.step_count, cortana_fitness_daily_facts.step_count)");
    expect(sql).toContain("COALESCE(EXCLUDED.readiness_score, cortana_fitness_daily_facts.readiness_score)");
    expect(sql).toContain("coach''s summary");
  });

  it("builds a window summary query bounded by start/end dates", () => {
    const sql = buildFitnessWindowSummarySql("2026-03-01", "2026-03-31");
    expect(sql).toContain("snapshot_date BETWEEN '2026-03-01'::date AND '2026-03-31'::date");
    expect(sql).toContain("days_with_steps");
    expect(sql).toContain("total_steps");
    expect(sql).toContain("avg_daily_steps");
    expect(sql).toContain("avg_hydration_liters");
    expect(sql).toContain("protein_days_on_target");
  });
});
