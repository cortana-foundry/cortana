#!/usr/bin/env python3
"""
Extract atomic facts from recent OpenClaw session transcripts and store in LanceDB.

Usage:
  python3 tools/memory/extract-from-sessions.py --since-hours 24
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Sequence
from uuid import uuid4


DEFAULT_DB_PATH = os.path.expanduser("~/.openclaw/memory/lancedb")
DEFAULT_CONFIG_PATH = os.path.expanduser("~/.openclaw/openclaw.json")
DEFAULT_SESSIONS_GLOB = os.path.expanduser("~/.openclaw/agents/main/sessions/*.jsonl")
TABLE_NAME = "memories"
EMBED_MODEL = "text-embedding-3-small"
EXTRACT_MODEL = "gpt-4o-mini"


class ConfigError(RuntimeError):
    pass


def load_openai_key(config_path: str) -> str:
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    key = (
        cfg.get("plugins", {})
        .get("entries", {})
        .get("memory-lancedb", {})
        .get("config", {})
        .get("embedding", {})
        .get("apiKey")
    )
    if not key:
        raise ConfigError("OpenAI API key not found in openclaw.json at plugins.entries.memory-lancedb.config.embedding.apiKey")
    return key


def http_post_json(url: str, payload: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def embed_texts(api_key: str, texts: Sequence[str]) -> List[List[float]]:
    if not texts:
        return []
    data = http_post_json(
        "https://api.openai.com/v1/embeddings",
        {"model": EMBED_MODEL, "input": list(texts)},
        api_key,
    )
    return [row["embedding"] for row in data["data"]]


def extract_facts_from_transcript(api_key: str, transcript: str) -> List[str]:
    system_prompt = (
        "You extract long-term memory facts from assistant-user conversation transcripts. "
        "Output only strict JSON with schema: {\"facts\": [\"...\"]}. "
        "Rules: ignore casual chatter; include only durable, useful facts/preferences/decisions/entities. "
        "Resolve pronouns to explicit nouns/names whenever possible using transcript context. "
        "Each fact must be atomic and self-contained. "
        "No duplicates, no meta-commentary."
    )
    payload = {
        "model": EXTRACT_MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": transcript},
        ],
    }
    out = http_post_json("https://api.openai.com/v1/chat/completions", payload, api_key)
    content = out["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    facts = parsed.get("facts", [])
    cleaned = []
    seen = set()
    for fact in facts:
        if not isinstance(fact, str):
            continue
        f = " ".join(fact.split()).strip()
        if not f:
            continue
        k = f.lower()
        if k in seen:
            continue
        seen.add(k)
        cleaned.append(f)
    return cleaned


def parse_timestamp(ts: str) -> datetime:
    # Handles ISO 8601 with trailing Z
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def iter_recent_session_files(since: datetime, pattern: str) -> List[Path]:
    paths = []
    for raw in glob.glob(pattern):
        p = Path(raw)
        if ".deleted." in p.name:
            continue
        if p.suffix != ".jsonl":
            continue
        try:
            mtime = datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)
        except FileNotFoundError:
            continue
        if mtime >= since:
            paths.append(p)
    return sorted(paths)


def build_transcript_from_jsonl(path: Path, since: datetime) -> str:
    lines: List[str] = []
    with path.open("r", encoding="utf-8", errors="ignore") as f:
        for raw in f:
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if obj.get("type") != "message":
                continue
            msg = obj.get("message", {})
            role = msg.get("role")
            if role not in {"user", "assistant"}:
                continue

            ts = obj.get("timestamp") or msg.get("timestamp")
            if ts:
                try:
                    if parse_timestamp(ts) < since:
                        continue
                except Exception:
                    pass

            content = msg.get("content", [])
            text_chunks: List[str] = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
                    text_chunks.append(part["text"])
            if not text_chunks:
                continue
            text = "\n".join(text_chunks).strip()
            if text:
                lines.append(f"{role.upper()}: {text}")

    joined = "\n".join(lines)
    # keep token usage bounded per session
    if len(joined) > 24000:
        joined = joined[-24000:]
    return joined


def require_lancedb():
    try:
        import lancedb  # type: ignore
    except Exception as e:
        raise RuntimeError("Missing dependency: lancedb. Install with: python3 -m pip install lancedb") from e
    return lancedb


def open_or_create_memories_table(db_path: str, vector_dim: int):
    lancedb = require_lancedb()
    db = lancedb.connect(db_path)
    tables = set(db.table_names())
    if TABLE_NAME in tables:
        return db.open_table(TABLE_NAME)

    seed = [{
        "id": "__schema__",
        "text": "",
        "vector": [0.0] * vector_dim,
        "importance": 0.0,
        "category": "fact",
        "createdAt": 0,
        "source": "session_extract",
    }]
    t = db.create_table(TABLE_NAME, data=seed)
    t.delete('id = "__schema__"')
    return t


def similarity_from_distance(distance: float) -> float:
    return 1.0 / (1.0 + float(distance))


def is_duplicate(table: Any, vector: Sequence[float], threshold: float = 0.95) -> bool:
    # Works with LanceDB's Python API query object.
    try:
        rows = table.search(vector).limit(8).to_list()
    except Exception:
        try:
            rows = table.vector_search(vector).limit(8).to_list()
        except Exception:
            return False

    for row in rows:
        dist = row.get("_distance", 0.0)
        if similarity_from_distance(dist) > threshold:
            return True
    return False


def store_memory_row(table: Any, text: str, vector: Sequence[float], category: str = "fact") -> None:
    now_ms = int(time.time() * 1000)
    row = {
        "id": str(uuid4()),
        "text": text,
        "vector": list(vector),
        "importance": 0.8,
        "category": category,
        "createdAt": now_ms,
        "source": "session_extract",
    }
    table.add([row])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-hours", type=int, default=24)
    ap.add_argument("--sessions-glob", default=DEFAULT_SESSIONS_GLOB)
    ap.add_argument("--db-path", default=DEFAULT_DB_PATH)
    ap.add_argument("--config", default=DEFAULT_CONFIG_PATH)
    args = ap.parse_args()

    since = datetime.now(timezone.utc) - timedelta(hours=args.since_hours)
    api_key = load_openai_key(args.config)

    session_files = iter_recent_session_files(since, args.sessions_glob)

    extracted_facts: List[str] = []
    for p in session_files:
        transcript = build_transcript_from_jsonl(p, since)
        if not transcript.strip():
            continue
        facts = extract_facts_from_transcript(api_key, transcript)
        extracted_facts.extend(facts)

    # exact dedup before embedding/search
    deduped_facts = []
    seen = set()
    for f in extracted_facts:
        k = f.lower()
        if k in seen:
            continue
        seen.add(k)
        deduped_facts.append(f)

    if deduped_facts:
        vectors = embed_texts(api_key, deduped_facts)
        table = open_or_create_memories_table(args.db_path, len(vectors[0]))
    else:
        vectors = []
        table = None

    stored = 0
    duplicates = 0
    for fact, vec in zip(deduped_facts, vectors):
        if is_duplicate(table, vec, threshold=0.95):
            duplicates += 1
            continue
        store_memory_row(table, fact, vec, category="fact")
        stored += 1

    print(
        f"Processed {len(session_files)} sessions, extracted {len(deduped_facts)} facts, "
        f"stored {stored} new memories ({duplicates} duplicates skipped)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
