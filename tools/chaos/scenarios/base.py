from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass
class ScenarioResult:
    name: str
    fault_type: str
    injected: bool
    detected: bool
    recovered: bool
    detection_ms: int
    recovery_ms: int
    notes: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)


class ChaosScenario:
    """Base class for safe chaos scenarios.

    Contract:
    - run() must not mutate production resources directly.
    - scenario uses simulation artifacts only (tmp files/env vars/mocks).
    """

    name: str = "base"
    fault_type: str = "unknown"

    def run(self) -> ScenarioResult:
        raise NotImplementedError


def serialize_results(results: List[ScenarioResult]) -> List[Dict[str, Any]]:
    return [
        {
            "name": r.name,
            "fault_type": r.fault_type,
            "injected": r.injected,
            "detected": r.detected,
            "recovered": r.recovered,
            "detection_ms": r.detection_ms,
            "recovery_ms": r.recovery_ms,
            "notes": r.notes,
            "metadata": r.metadata,
        }
        for r in results
    ]
