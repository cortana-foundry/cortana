#!/usr/bin/env python3
"""Feedback Closure Verifier.

Audits whether corrections in `cortana_feedback` were actually closed by durable
updates in MEMORY.md / AGENTS.md / SOUL.md.

Commands:
- audit  : detailed analysis (semantic clustering + closure checks)
- report : concise health summary
- alert  : critical unclosed loops for escalation
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DB_NAME = "cortana"
DB_PATH = "/opt/homebrew/opt/postgresql@17/bin"

BASE_DIR = Path(__file__).resolve().parents[2]
EMBED_SCRIPT = BASE_DIR / "tools" / "embeddings" / "embed.py"
POLICY_FILES = {
    "memory": BASE_DIR / "MEMORY.md",
    "agents": BASE_DIR / "AGENTS.md",
    "soul": BASE_DIR / "SOUL.md",
}

TARGET_FILE_BY_TYPE = {
    "preference": "memory",
    "fact": "memory",
    "behavior": "agents",
    "correction": "agents",
    "tone": "soul",
}

STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "into", "when", "where", "have", "has", "had",
    "was", "were", "are", "is", "be", "been", "being", "you", "your", "our", "not", "but", "can", "could",
    "should", "would", "will", "don", "did", "didnt", "dont", "about", "after", "before", "then", "than",
    "they", "them", "their", "always", "never", "must", "need", "using", "use", "used", "just", "more", "less",
    "there", "here", "what", "which", "while", "because", "also", "into", "onto", "across", "through", "very",
}


@dataclass
class FeedbackRow:
    id: int
    timestamp: str
    feedback_type: str
    context: str
    lesson: str
    applied: bool


class VerifierError(RuntimeError):
    pass


def _sql_escape(text: str) -> str:
    return text.replace("'", "''")


def run_psql(sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = f"{DB_PATH}:{env.get('PATH', '')}"
    cmd = ["psql", DB_NAME, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise VerifierError(proc.stderr.strip() or "psql failed")
    return proc.stdout.strip()


def fetch_feedback(window_days: int | None = None, limit: int | None = None) -> list[FeedbackRow]:
    where = ""
    if window_days and window_days > 0:
        where = f"WHERE timestamp > NOW() - INTERVAL '{int(window_days)} days'"
    lim = f"LIMIT {int(limit)}" if limit and limit > 0 else ""

    sql = (
        "SELECT COALESCE(json_agg(t), '[]'::json)::text FROM ("
        "SELECT id, timestamp::text AS timestamp, COALESCE(feedback_type,'') AS feedback_type, "
        "COALESCE(context,'') AS context, COALESCE(lesson,'') AS lesson, COALESCE(applied, false) AS applied "
        f"FROM cortana_feedback {where} ORDER BY timestamp ASC {lim}"
        ") t;"
    )
    raw = run_psql(sql)
    rows = json.loads(raw or "[]")
    return [
        FeedbackRow(
            id=int(r["id"]),
            timestamp=r.get("timestamp", ""),
            feedback_type=(r.get("feedback_type") or "").lower() or "correction",
            context=r.get("context") or "",
            lesson=r.get("lesson") or "",
            applied=bool(r.get("applied", False)),
        )
        for r in rows
    ]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not EMBED_SCRIPT.exists():
        raise VerifierError(f"Embedding script missing: {EMBED_SCRIPT}")

    venv_python = BASE_DIR / "tools" / "embeddings" / ".venv" / "bin" / "python"
    python_bin = str(venv_python) if venv_python.exists() else sys.executable

    cmd = [python_bin, str(EMBED_SCRIPT), "embed", "--stdin"]
    proc = subprocess.run(cmd, input=json.dumps(texts), capture_output=True, text=True)
    if proc.returncode != 0:
        raise VerifierError(proc.stderr.strip() or "embedding failed")

    payload = json.loads(proc.stdout)
    vectors = payload.get("vectors") or []
    if len(vectors) != len(texts):
        raise VerifierError(f"embedding size mismatch: expected {len(texts)}, got {len(vectors)}")
    return vectors


def cluster_embeddings(vectors: list[list[float]], threshold: float) -> list[list[int]]:
    n = len(vectors)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if cosine(vectors[i], vectors[j]) >= threshold:
                union(i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)

    return sorted(groups.values(), key=len, reverse=True)


def extract_keywords(text: str, k: int = 6) -> list[str]:
    tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{2,}", text.lower())
    counts = Counter(t for t in tokens if t not in STOPWORDS)
    return [word for word, _ in counts.most_common(k)]


def load_policy_files() -> dict[str, str]:
    out: dict[str, str] = {}
    for key, path in POLICY_FILES.items():
        out[key] = path.read_text(encoding="utf-8") if path.exists() else ""
    return out


def file_keyword_hits(files: dict[str, str], keywords: list[str]) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {name: [] for name in files}
    for name, content in files.items():
        low = content.lower()
        for kw in keywords:
            if kw in low:
                hits[name].append(kw)
    return {name: sorted(set(words)) for name, words in hits.items()}


def feedback_text(row: FeedbackRow) -> str:
    return f"{row.feedback_type}\n{row.context}\n{row.lesson}".strip()


def run_audit(window_days: int | None, similarity_threshold: float, repeat_threshold: int, limit: int | None) -> dict[str, Any]:
    rows = fetch_feedback(window_days=window_days, limit=limit)
    if not rows:
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "total_feedback_entries": 0,
            "message": "No feedback rows found.",
            "clusters": [],
            "broken_loops": [],
            "closure_rate": 0.0,
        }

    texts = [feedback_text(r) for r in rows]
    vectors = embed_texts(texts)
    clusters = cluster_embeddings(vectors, threshold=similarity_threshold)
    files = load_policy_files()

    row_analysis: list[dict[str, Any]] = []
    for row in rows:
        keywords = extract_keywords(f"{row.context} {row.lesson}")
        hits = file_keyword_hits(files, keywords)
        target = TARGET_FILE_BY_TYPE.get(row.feedback_type, "agents")
        target_hits = hits.get(target, [])
        any_hits = sorted(set(x for words in hits.values() for x in words))
        closed = bool(target_hits or any_hits)

        row_analysis.append(
            {
                "id": row.id,
                "timestamp": row.timestamp,
                "feedback_type": row.feedback_type,
                "context": row.context,
                "lesson": row.lesson,
                "applied": row.applied,
                "keywords": keywords,
                "target_file": str(POLICY_FILES[target].name),
                "keyword_hits": hits,
                "closed": closed,
            }
        )

    cluster_reports: list[dict[str, Any]] = []
    broken_loops: list[dict[str, Any]] = []
    unclosed_topics: list[dict[str, Any]] = []

    for idxs in clusters:
        entries = [row_analysis[i] for i in idxs]
        size = len(entries)
        exemplar = max(entries, key=lambda e: len(e["lesson"] or e["context"]))
        closed_count = sum(1 for e in entries if e["closed"])
        closure_rate = closed_count / size if size else 0.0
        keywords = []
        for e in entries:
            keywords.extend(e["keywords"])
        top_keywords = [w for w, _ in Counter(keywords).most_common(8)]

        report = {
            "cluster_size": size,
            "feedback_ids": [e["id"] for e in entries],
            "feedback_types": sorted(set(e["feedback_type"] for e in entries)),
            "topic_example": exemplar["lesson"] or exemplar["context"],
            "top_keywords": top_keywords,
            "closed_entries": closed_count,
            "unclosed_entries": size - closed_count,
            "closure_rate": round(closure_rate, 3),
            "broken_loop": size > repeat_threshold,
        }
        cluster_reports.append(report)

        if report["broken_loop"]:
            broken_loops.append(report)
        if report["unclosed_entries"] > 0:
            unclosed_topics.append(report)

    total = len(row_analysis)
    closed_total = sum(1 for r in row_analysis if r["closed"])
    repeated_entries = sum(len(c) for c in clusters if len(c) > 1)
    unique_entries = total - repeated_entries

    unclosed_topics = sorted(
        unclosed_topics,
        key=lambda r: (r["unclosed_entries"], r["cluster_size"]),
        reverse=True,
    )

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "settings": {
            "window_days": window_days,
            "similarity_threshold": similarity_threshold,
            "repeat_threshold": repeat_threshold,
            "limit": limit,
        },
        "total_feedback_entries": total,
        "cluster_count": len(clusters),
        "unique_entries": unique_entries,
        "repeated_entries": repeated_entries,
        "closure_rate": round(closed_total / total, 3) if total else 0.0,
        "closed_entries": closed_total,
        "unclosed_entries": total - closed_total,
        "clusters": cluster_reports,
        "broken_loops": broken_loops,
        "top_unclosed_feedback_items": unclosed_topics[:5],
        "entries": row_analysis,
    }


def summarize_report(audit: dict[str, Any]) -> dict[str, Any]:
    total = int(audit.get("total_feedback_entries", 0))
    repeated = int(audit.get("repeated_entries", 0))
    unique = int(audit.get("unique_entries", max(0, total - repeated)))
    closure_rate = float(audit.get("closure_rate", 0.0))
    broken_loops = audit.get("broken_loops", []) or []

    return {
        "generated_at": audit.get("generated_at"),
        "total_feedback_entries": total,
        "unique_entries": unique,
        "repeated_entries": repeated,
        "closure_rate": closure_rate,
        "broken_loop_topics": len(broken_loops),
        "top_unclosed_feedback_items": audit.get("top_unclosed_feedback_items", [])[:5],
    }


def critical_alerts(audit: dict[str, Any]) -> list[dict[str, Any]]:
    critical: list[dict[str, Any]] = []
    for cluster in audit.get("broken_loops", []) or []:
        if cluster.get("unclosed_entries", 0) >= 2 or cluster.get("closure_rate", 1.0) < 0.5:
            critical.append(
                {
                    "feedback_ids": cluster.get("feedback_ids", []),
                    "topic_example": cluster.get("topic_example", ""),
                    "cluster_size": cluster.get("cluster_size", 0),
                    "unclosed_entries": cluster.get("unclosed_entries", 0),
                    "closure_rate": cluster.get("closure_rate", 0.0),
                    "top_keywords": cluster.get("top_keywords", []),
                    "message": "Critical unclosed feedback loop detected.",
                }
            )
    return critical


def maybe_write_json(path: str | None, payload: dict[str, Any] | list[dict[str, Any]]) -> None:
    if not path:
        return
    p = Path(path).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify whether feedback loops were actually closed.")
    sub = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--window-days", type=int, default=None, help="Only analyze this many recent days")
    common.add_argument("--limit", type=int, default=None, help="Max feedback entries to analyze")
    common.add_argument("--similarity-threshold", type=float, default=0.82, help="Cluster similarity threshold (0-1)")
    common.add_argument("--repeat-threshold", type=int, default=2, help="Cluster size > threshold => broken loop")

    p_audit = sub.add_parser("audit", parents=[common], help="Run full feedback closure audit")
    p_audit.add_argument("--output", help="Write JSON output to file")

    p_report = sub.add_parser("report", parents=[common], help="Output summary report")
    p_report.add_argument("--output", help="Write JSON output to file")

    p_alert = sub.add_parser("alert", parents=[common], help="Output critical unclosed loops")
    p_alert.add_argument("--output", help="Write JSON output to file")

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    audit = run_audit(
        window_days=args.window_days,
        similarity_threshold=min(0.99, max(0.1, args.similarity_threshold)),
        repeat_threshold=max(1, args.repeat_threshold),
        limit=args.limit,
    )

    if args.command == "audit":
        maybe_write_json(args.output, audit)
        print(json.dumps(audit, indent=2))
        return 0

    if args.command == "report":
        report = summarize_report(audit)
        maybe_write_json(args.output, report)
        print(json.dumps(report, indent=2))
        return 0

    if args.command == "alert":
        alerts = critical_alerts(audit)
        out = {"generated_at": audit.get("generated_at"), "alerts": alerts, "count": len(alerts)}
        maybe_write_json(args.output, out)
        print(json.dumps(out, indent=2))
        return 0

    raise VerifierError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
