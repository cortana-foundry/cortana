from __future__ import annotations

import time

from .base import ChaosScenario, ScenarioResult


class CronFailureScenario(ChaosScenario):
    name = "cron_failure"
    fault_type = "cron"

    def run(self) -> ScenarioResult:
        start = time.perf_counter()
        # Simulate missed/hung cron detection.
        time.sleep(0.06)
        detected_ms = int((time.perf_counter() - start) * 1000)

        # Simulate auto-remediation (reschedule nextRunAtMs + stale running clear).
        time.sleep(0.05)
        recovery_ms = int((time.perf_counter() - start) * 1000)

        return ScenarioResult(
            name=self.name,
            fault_type=self.fault_type,
            injected=True,
            detected=True,
            recovered=True,
            detection_ms=detected_ms,
            recovery_ms=recovery_ms,
            notes="Simulated missed/hung cron with restart+reschedule remediation.",
            metadata={"simulated_state": "missed_run", "actions": ["clear_stale_running", "reschedule"]},
        )
