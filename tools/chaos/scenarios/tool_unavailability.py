from __future__ import annotations

import time

from .base import ChaosScenario, ScenarioResult


class ToolUnavailabilityScenario(ChaosScenario):
    name = "tool_unavailability"
    fault_type = "tool"

    def run(self) -> ScenarioResult:
        start = time.perf_counter()
        # Simulate timeout/service-down probe.
        time.sleep(0.05)
        detected_ms = int((time.perf_counter() - start) * 1000)

        # Simulate fallback path / self-heal (e.g., alternative endpoint).
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
            notes="Simulated API timeout with fallback recovery path.",
            metadata={"simulated_error": "timeout", "fallback": "secondary_probe"},
        )
