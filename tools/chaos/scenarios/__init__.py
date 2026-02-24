from .base import ChaosScenario, ScenarioResult, serialize_results
from .cron_failure import CronFailureScenario
from .db_connection_issue import DbConnectionIssueScenario
from .heartbeat_miss import HeartbeatMissScenario
from .memory_corruption import MemoryCorruptionScenario
from .tool_unavailability import ToolUnavailabilityScenario

SCENARIO_REGISTRY = {
    "tool_unavailability": ToolUnavailabilityScenario,
    "cron_failure": CronFailureScenario,
    "db_connection_issue": DbConnectionIssueScenario,
    "memory_corruption": MemoryCorruptionScenario,
    "heartbeat_miss": HeartbeatMissScenario,
}
