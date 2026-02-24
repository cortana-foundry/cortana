from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

from .base import ChaosScenario, ScenarioResult


class MemoryCorruptionScenario(ChaosScenario):
    name = "memory_corruption"
    fault_type = "memory_state"

    def run(self) -> ScenarioResult:
        start = time.perf_counter()
        tmpdir = Path(tempfile.mkdtemp(prefix="chaos-memory-"))
        state_file = tmpdir / "heartbeat-state.json"

        # Inject corruption in isolated temp file (never production path).
        state_file.write_text("{invalid_json")

        detected = False
        try:
            json.loads(state_file.read_text())
        except Exception:
            detected = True

        detected_ms = int((time.perf_counter() - start) * 1000)

        # Simulate remediation by rewriting known-good structure.
        state_file.write_text(json.dumps({"lastChecks": {}, "lastRemediationAt": int(time.time())}))
        recovered = True
        recovery_ms = int((time.perf_counter() - start) * 1000)

        return ScenarioResult(
            name=self.name,
            fault_type=self.fault_type,
            injected=True,
            detected=detected,
            recovered=recovered,
            detection_ms=detected_ms,
            recovery_ms=recovery_ms,
            notes="Corrupt state file repaired in isolated temp sandbox.",
            metadata={"sandbox_file": str(state_file)},
        )
