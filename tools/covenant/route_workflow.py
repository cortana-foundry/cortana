#!/usr/bin/env python3
"""Route Covenant operational workflows across Monitor/Huragok/Oracle/Librarian.

Usage:
  python3 tools/covenant/route_workflow.py --plan <routing-request.json>
  python3 tools/covenant/route_workflow.py --failure <failure-event.json>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

AGENT_MONITOR = "agent.monitor.v1"
AGENT_HURAGOK = "agent.huragok.v1"
AGENT_ORACLE = "agent.oracle.v1"
AGENT_LIBRARIAN = "agent.librarian.v1"

ALLOWED_AGENTS = {AGENT_MONITOR, AGENT_HURAGOK, AGENT_ORACLE, AGENT_LIBRARIAN}

HandoffPattern = tuple[str, list[str]]
HANDOFF_PATTERNS: dict[str, HandoffPattern] = {
    "oracle_librarian_huragok": (
        "Research/options first, lock implementation contract, then execute.",
        [AGENT_ORACLE, AGENT_LIBRARIAN, AGENT_HURAGOK],
    ),
    "monitor_huragok_monitor": (
        "Detect/triage incident, implement fix, then verify recovery.",
        [AGENT_MONITOR, AGENT_HURAGOK, AGENT_MONITOR],
    ),
    "librarian_huragok_librarian": (
        "Define contract, implement, then align documentation/spec integrity.",
        [AGENT_LIBRARIAN, AGENT_HURAGOK, AGENT_LIBRARIAN],
    ),
}

KEYWORDS = {
    AGENT_MONITOR: {
        "monitor",
        "health",
        "watchdog",
        "uptime",
        "budget",
        "incident",
        "triage",
        "verify",
        "verification",
    },
    AGENT_HURAGOK: {
        "implement",
        "implementation",
        "code",
        "fix",
        "patch",
        "test",
        "refactor",
        "build",
    },
    AGENT_ORACLE: {
        "research",
        "options",
        "compare",
        "investigate",
        "decision",
        "analysis",
        "evaluate",
    },
    AGENT_LIBRARIAN: {
        "spec",
        "contract",
        "runbook",
        "architecture",
        "documentation",
        "doc",
        "align",
    },
}

HARD_ESCALATE_FAILURES = {"auth_failure", "permission_denied", "requirements_ambiguous"}
TRANSIENT_FAILURES = {"transient_tool_failure", "network_timeout", "timeout"}


class RoutingError(Exception):
    pass


def _load_json(path: Path, label: str) -> dict[str, Any]:
    if not path.exists():
        raise RoutingError(f"{label} not found: {path}")
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise RoutingError(f"{label} invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise RoutingError(f"{label} root must be an object")
    return payload


def _normalize_tokens(payload: dict[str, Any]) -> set[str]:
    tokens: set[str] = set()

    objective = payload.get("objective")
    if isinstance(objective, str):
        for part in objective.lower().replace("→", " ").replace("-", " ").split():
            clean = "".join(c for c in part if c.isalnum() or c == "_")
            if clean:
                tokens.add(clean)

    intents = payload.get("intents")
    if isinstance(intents, list):
        for item in intents:
            if isinstance(item, str) and item.strip():
                tokens.add(item.strip().lower())

    workflow_type = payload.get("workflow_type")
    if isinstance(workflow_type, str) and workflow_type.strip():
        tokens.add(workflow_type.strip().lower())

    return tokens


def _choose_pattern(tokens: set[str]) -> tuple[str, list[str], str] | None:
    has_research = any(t in tokens for t in {"research", "decision", "compare", "evaluate", "analysis"})
    has_spec = any(t in tokens for t in {"spec", "contract", "architecture", "runbook", "documentation", "doc"})
    has_implementation = any(t in tokens for t in {"implement", "implementation", "code", "fix", "patch", "build", "test"})
    has_monitoring = any(t in tokens for t in {"monitor", "health", "incident", "triage", "verify", "verification", "uptime"})

    if has_research and has_spec and has_implementation:
        reason, chain = HANDOFF_PATTERNS["oracle_librarian_huragok"]
        return "oracle_librarian_huragok", chain, reason

    if has_monitoring and has_implementation and has_monitoring:
        reason, chain = HANDOFF_PATTERNS["monitor_huragok_monitor"]
        return "monitor_huragok_monitor", chain, reason

    if has_spec and has_implementation:
        reason, chain = HANDOFF_PATTERNS["librarian_huragok_librarian"]
        return "librarian_huragok_librarian", chain, reason

    return None


def _single_agent_route(tokens: set[str]) -> tuple[str, str]:
    scores = {agent: 0 for agent in ALLOWED_AGENTS}
    for agent, words in KEYWORDS.items():
        scores[agent] = len(tokens.intersection(words))

    best_agent = max(scores, key=scores.get)
    if scores[best_agent] == 0:
        return AGENT_HURAGOK, "Defaulted to Huragok for execution-oriented fallback when signal is weak."

    reason_map = {
        AGENT_MONITOR: "Detected health/triage/run-state signals.",
        AGENT_HURAGOK: "Detected implementation/fix/test signals.",
        AGENT_ORACLE: "Detected research/decision-support signals.",
        AGENT_LIBRARIAN: "Detected spec/contract/documentation signals.",
    }
    return best_agent, reason_map[best_agent]


def build_plan(payload: dict[str, Any]) -> dict[str, Any]:
    explicit = payload.get("handoff_pattern")
    if isinstance(explicit, str) and explicit.strip():
        key = explicit.strip().lower()
        if key not in HANDOFF_PATTERNS:
            raise RoutingError(
                f"unsupported handoff_pattern '{key}'. Expected one of: {', '.join(sorted(HANDOFF_PATTERNS.keys()))}"
            )
        reason, chain = HANDOFF_PATTERNS[key]
        return {
            "mode": "handoff_chain",
            "selected_pattern": key,
            "primary_agent_identity_id": chain[0],
            "handoff_chain": chain,
            "routing_reason": reason,
        }

    tokens = _normalize_tokens(payload)
    pattern = _choose_pattern(tokens)
    if pattern:
        key, chain, reason = pattern
        return {
            "mode": "handoff_chain",
            "selected_pattern": key,
            "primary_agent_identity_id": chain[0],
            "handoff_chain": chain,
            "routing_reason": reason,
        }

    agent, reason = _single_agent_route(tokens)
    return {
        "mode": "single_agent",
        "selected_pattern": None,
        "primary_agent_identity_id": agent,
        "handoff_chain": [agent],
        "routing_reason": reason,
    }


def plan_failure(payload: dict[str, Any]) -> dict[str, Any]:
    failure_type = payload.get("failure_type")
    agent_identity_id = payload.get("agent_identity_id")
    attempt = payload.get("attempt")
    max_retries = payload.get("max_retries")

    if not isinstance(failure_type, str) or not failure_type.strip():
        raise RoutingError("failure_type is required")
    failure_type = failure_type.strip().lower()

    if not isinstance(agent_identity_id, str) or agent_identity_id not in ALLOWED_AGENTS:
        raise RoutingError("agent_identity_id must be one of known Covenant identities")
    if not isinstance(attempt, int) or attempt < 1:
        raise RoutingError("attempt must be integer >= 1")
    if not isinstance(max_retries, int) or max_retries < 0:
        raise RoutingError("max_retries must be integer >= 0")

    if failure_type in HARD_ESCALATE_FAILURES:
        return {
            "action": "escalate_immediately",
            "state": "blocked",
            "route_to": None,
            "reason": "Hard-blocking failure class; retries are unsafe by policy.",
            "required_decision": "Cortana must resolve auth/permissions/requirements ambiguity before continuing.",
        }

    if failure_type in TRANSIENT_FAILURES and attempt <= max_retries:
        return {
            "action": "retry_same_agent",
            "state": "in_progress",
            "route_to": agent_identity_id,
            "reason": "Transient/timeout failure within retry budget.",
            "required_decision": None,
        }

    # Second failure (or retry budget exhausted): escalate with suggested chain continuation.
    suggestion = {
        AGENT_ORACLE: AGENT_LIBRARIAN,
        AGENT_MONITOR: AGENT_HURAGOK,
        AGENT_HURAGOK: AGENT_MONITOR,
        AGENT_LIBRARIAN: AGENT_HURAGOK,
    }[agent_identity_id]

    return {
        "action": "escalate_with_route_suggestion",
        "state": "blocked",
        "route_to": suggestion,
        "reason": "Failure exceeded retry budget or non-transient class.",
        "required_decision": "Cortana should narrow scope, switch agent, or request human input.",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Route Covenant workflows and failure playbooks")
    parser.add_argument("--plan", help="Path to routing request JSON")
    parser.add_argument("--failure", help="Path to failure-event JSON")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if bool(args.plan) == bool(args.failure):
        print("Usage: route_workflow.py --plan <routing-request.json> | --failure <failure-event.json>", file=sys.stderr)
        raise SystemExit(2)

    try:
        if args.plan:
            payload = _load_json(Path(args.plan).expanduser().resolve(), "routing request")
            result = build_plan(payload)
            print("ROUTING_PLAN_JSON: " + json.dumps(result, separators=(",", ":"), sort_keys=True))
            return

        payload = _load_json(Path(args.failure).expanduser().resolve(), "failure event")
        result = plan_failure(payload)
        print("ROUTING_FAILURE_PLAN_JSON: " + json.dumps(result, separators=(",", ":"), sort_keys=True))
    except RoutingError as exc:
        print(f"ROUTING_INVALID: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
