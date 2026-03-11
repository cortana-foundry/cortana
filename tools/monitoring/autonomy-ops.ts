#!/usr/bin/env -S npx tsx
import { collectAutonomyStatus } from "./autonomy-status.ts";
import { buildRolloutSummary } from "./autonomy-rollout.ts";
import { runAutonomyDrill } from "./autonomy-drill.ts";

export function buildAutonomyOpsSummary() {
  const status = collectAutonomyStatus();
  const rollout = buildRolloutSummary();
  const drill = runAutonomyDrill();

  const operatorState = rollout.status === "attention" || drill.status === "attention"
    ? "attention"
    : rollout.status === "watch" || status.autoRemediated > 0
      ? "watch"
      : "live";

  return {
    posture: status.posture,
    operatorState,
    autoFixed: status.autoFixedItems,
    degraded: status.deferredItems,
    waitingOnHamel: status.waitingOnHuman,
    blocked: [
      ...(rollout.reasons ?? []),
      ...(drill.scenarios.filter((item) => !item.passed).map((item) => `${item.scenario}:${item.escalateWhen}`)),
    ],
    familyCritical: {
      tracked: drill.scenarios.filter((item) => item.lane === "family_critical").map((item) => item.scenario),
      failures: drill.familyCriticalFailures,
      stricterEscalation: true,
    },
    counts: {
      autoRemediated: status.autoRemediated,
      escalated: status.escalated,
      needsHuman: status.needsHuman,
      actionable: status.actionable,
      suppressed: status.suppressed,
    },
  };
}

export function renderAutonomyOpsSummary(summary: ReturnType<typeof buildAutonomyOpsSummary>): string {
  const lines = [
    "🧭 Cortana Operator Surface",
    `- posture: ${summary.posture}`,
    `- operator state: ${summary.operatorState}`,
    `- auto-fixed: ${summary.autoFixed.length ? summary.autoFixed.join(", ") : "none"}`,
    `- degraded: ${summary.degraded.length ? summary.degraded.join(", ") : "none"}`,
    `- waiting on Hamel: ${summary.waitingOnHamel.length ? summary.waitingOnHamel.join(", ") : "none"}`,
    `- blocked/exceeded authority: ${summary.blocked.length ? summary.blocked.join(", ") : "none"}`,
    `- family-critical tracked: ${summary.familyCritical.tracked.length ? summary.familyCritical.tracked.join(", ") : "none"}`,
    `- family-critical failures: ${summary.familyCritical.failures}`,
    `- counts: autoRemediated=${summary.counts.autoRemediated} escalated=${summary.counts.escalated} needsHuman=${summary.counts.needsHuman} actionable=${summary.counts.actionable} suppressed=${summary.counts.suppressed}`,
  ];
  return lines.join("\n");
}

function main() {
  const summary = buildAutonomyOpsSummary();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.operatorState === "live") {
    return;
  }

  console.log(renderAutonomyOpsSummary(summary));
  process.exit(summary.operatorState === "attention" ? 1 : 0);
}

main();
