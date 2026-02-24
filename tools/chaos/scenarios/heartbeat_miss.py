from __future__ import annotations

import time

from .base import ChaosScenario, ScenarioResult


class HeartbeatMissScenario(ChaosScenario):
    name = "heartbeat_miss"
    fault_type = "heartbeat"

    def run(self) -> ScenarioResult:
        start = time.perf_counter()
        # Simulate heartbeat miss signal from stale state / missing ACK.
        time.sleep(0.05)
        detected_ms = int((time.perf_counter() - start) * 1000)

        # Simulate remediation: force next run + state refresh.
        time.sleep(0.04)
        recovery_ms = int((time.perf_counter() - start) * 1000)

        return ScenarioResult(
            name=self.name,
            fault_type=self.fault_type,
            injected=True,
            detected=True,
            recovered=True,
            detection_ms=detected_ms,
            recovery_ms=recovery_ms,
            notes="Simulated heartbeat miss with auto-remediation guardrails.",
            metadata={"signal": "stale_heartbeat", "remediation": "reschedule_and_refresh"},
        )
