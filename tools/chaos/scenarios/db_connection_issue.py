from __future__ import annotations

import time

from .base import ChaosScenario, ScenarioResult


class DbConnectionIssueScenario(ChaosScenario):
    name = "db_connection_issue"
    fault_type = "database"

    def run(self) -> ScenarioResult:
        start = time.perf_counter()
        # Simulate transient DB connection failure and health-check detection.
        time.sleep(0.04)
        detected_ms = int((time.perf_counter() - start) * 1000)

        # Simulate retry with exponential backoff + reconnect success.
        time.sleep(0.07)
        recovery_ms = int((time.perf_counter() - start) * 1000)

        return ScenarioResult(
            name=self.name,
            fault_type=self.fault_type,
            injected=True,
            detected=True,
            recovered=True,
            detection_ms=detected_ms,
            recovery_ms=recovery_ms,
            notes="Simulated temporary DB outage recovered by retry policy.",
            metadata={"simulated_error": "connection_refused", "retry_attempts": 2},
        )
