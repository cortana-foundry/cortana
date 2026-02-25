#!/usr/bin/env python3
"""Atomic fact extraction pipeline for cortana_memory_semantic.

Usage examples:
  python3 tools/memory/extract_facts.py extract --text "Hamel prefers 12-hour time format"
  python3 tools/memory/extract_facts.py extract --from-file memory/2026-02-25.md
  python3 tools/memory/extract_facts.py extract --from-dir memory --since-days 2
  python3 tools/memory/extract_facts.py extract --from-file memory/2026-02-25.md --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

WORKSPACE = Path("/Users/hd/clawd")
PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
DB_NAME = "cortana"
EMBED_SCRIPT = WORKSPACE / "tools" / "embeddings" / "embed.py"
EMBED_BIN = WORKSPACE / "tools" / "embeddings" / "embed"

VALID_TYPES = {"fact", "preference", "decision", "event", "system_rule"}

PROMPT = """You extract ATOMIC FACTS from conversation transcripts.
Return ONLY valid JSON object:
{"facts": [{"type":"fact|preference|decision|event|system_rule","content":"...","tags":["..."],"people":["..."],"confidence":0.0,"importance":0.0}]}

Rules:
- Atomic: exactly one concept per fact.
- Self-contained: no pronouns like he/she/they/it/this/that unless fully resolved.
- Specific and objective language.
- Keep content concise but complete.
- confidence and importance must be between 0 and 1.
- Skip vague/uncertain claims.

Text:
---
{TEXT}
---
"""

FALLBACK_TEMPLATE = """# Manual Review Required (Ollama extraction unavailable)

Convert this text into JSON with schema:
{"facts": [{"type","content","tags","people","confidence","importance"}]}

Constraints:
- type ∈ {fact, preference, decision, event, system_rule}
- content is atomic + self-contained (no unresolved pronouns)
- tags and people are arrays of strings
- confidence and importance are numeric [0,1]

Source: {source}

Text:
{text}
"""


@dataclass
class Fact:
    fact_type: str
    content: str
    tags: list[str]
    people: list[str]
    confidence: float
    importance: float


def _q(value: Any) -> str:
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def psql(sql: str, capture: bool = False) -> str:
    proc = subprocess.run(
        [PSQL_BIN, DB_NAME, "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql failed")
    out = (proc.stdout or "").strip()
    if not capture:
        return ""
    return out


def ensure_schema() -> None:
    sql = """
ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS supersedes_id BIGINT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_source TEXT,
  ADD COLUMN IF NOT EXISTS embedding_local VECTOR(384);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cortana_memory_semantic_supersedes_id_fkey'
  ) THEN
    ALTER TABLE cortana_memory_semantic
      ADD CONSTRAINT cortana_memory_semantic_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES cortana_memory_semantic(id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cortana_memory_semantic_fact_type_check'
  ) THEN
    ALTER TABLE cortana_memory_semantic DROP CONSTRAINT cortana_memory_semantic_fact_type_check;
  END IF;

  ALTER TABLE cortana_memory_semantic
    ADD CONSTRAINT cortana_memory_semantic_fact_type_check
    CHECK (fact_type = ANY (ARRAY['fact','preference','decision','event','system_rule','rule','relationship']));
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_semantic_embedding_local_hnsw
  ON cortana_memory_semantic USING hnsw (embedding_local vector_cosine_ops)
  WHERE embedding_local IS NOT NULL;
"""
    psql(sql)


def ollama_extract(text: str, model: str) -> dict[str, Any] | None:
    payload = {
        "model": model,
        "prompt": PROMPT.replace("{TEXT}", text[:12000]),
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.1},
    }
    try:
        proc = subprocess.run(
            ["curl", "-sS", "http://127.0.0.1:11434/api/generate", "-d", json.dumps(payload)],
            capture_output=True,
            text=True,
            timeout=90,
        )
        if proc.returncode != 0:
            return None
        parsed = json.loads(proc.stdout or "{}")
        response = (parsed.get("response") or "").strip()
        if not response:
            return None
        return json.loads(response)
    except Exception:
        return None


def validate_fact(raw: dict[str, Any]) -> Fact | None:
    if not isinstance(raw, dict):
        return None

    t = str(raw.get("type", "")).strip()
    content = str(raw.get("content", "")).strip()
    tags_raw = raw.get("tags", [])
    people_raw = raw.get("people", [])

    if t not in VALID_TYPES:
        return None
    if not content or len(content) < 8:
        return None

    # Basic self-contained guard against unresolved pronouns.
    if re.search(r"\b(he|she|they|it|this|that|these|those)\b", content, flags=re.IGNORECASE):
        return None

    try:
        confidence = float(raw.get("confidence", 0.5))
        importance = float(raw.get("importance", 0.5))
    except Exception:
        return None

    confidence = max(0.0, min(1.0, confidence))
    importance = max(0.0, min(1.0, importance))

    tags = [str(x).strip() for x in (tags_raw if isinstance(tags_raw, list) else []) if str(x).strip()]
    people = [str(x).strip() for x in (people_raw if isinstance(people_raw, list) else []) if str(x).strip()]

    return Fact(
        fact_type=t,
        content=content,
        tags=tags[:12],
        people=people[:12],
        confidence=confidence,
        importance=importance,
    )


def extract_facts(text: str, source: str, model: str) -> tuple[list[Fact], str | None]:
    parsed = ollama_extract(text, model)
    if not parsed:
        return [], FALLBACK_TEMPLATE.format(source=source, text=text[:12000])

    facts_raw = parsed.get("facts", []) if isinstance(parsed, dict) else []
    out: list[Fact] = []
    for fr in facts_raw:
        fact = validate_fact(fr)
        if fact:
            out.append(fact)
    return out, None


def embed_text(text: str) -> list[float]:
    cmd = [str(EMBED_BIN), "embed", "--text", text] if EMBED_BIN.exists() else ["python3", str(EMBED_SCRIPT), "embed", "--text", text]
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "embedding failed")
    payload = json.loads(proc.stdout or "{}")
    vectors = payload.get("vectors") or []
    if not vectors:
        raise RuntimeError("embedding returned no vectors")
    vec = vectors[0]
    if not isinstance(vec, list):
        raise RuntimeError("invalid embedding format")
    return vec


def vec_to_sql(vec: list[float]) -> str:
    return "'[%s]'" % ",".join(f"{float(v):.8f}" for v in vec)


def contradiction_check(existing: str, new: str, model: str) -> bool:
    prompt = f"""Return only JSON: {{\"contradiction\": true|false}}.
Do these statements conflict for the same person/context?
A: {existing}
B: {new}
"""
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
    }
    try:
        proc = subprocess.run(
            ["curl", "-sS", "http://127.0.0.1:11434/api/generate", "-d", json.dumps(payload)],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if proc.returncode != 0:
            return False
        data = json.loads(proc.stdout or "{}")
        res = json.loads((data.get("response") or "{}").strip())
        return bool(res.get("contradiction"))
    except Exception:
        return False


def dedupe_and_store(fact: Fact, source: str, model: str, dry_run: bool) -> dict[str, Any]:
    vec = embed_text(fact.content)
    vec_sql = vec_to_sql(vec)

    sql_neighbors = f"""
SELECT id, object_value, fact_type,
       1 - (embedding_local <=> {vec_sql}::vector) AS sim
FROM cortana_memory_semantic
WHERE active = TRUE AND embedding_local IS NOT NULL
ORDER BY embedding_local <=> {vec_sql}::vector
LIMIT 5;
"""
    rows = psql(sql_neighbors, capture=True).splitlines()

    best: tuple[int, str, str, float] | None = None
    for row in rows:
        if not row:
            continue
        parts = row.split("|", 3)
        if len(parts) != 4:
            continue
        rid, content, ft, sim = parts
        try:
            tup = (int(rid), content, ft, float(sim))
        except Exception:
            continue
        if best is None or tup[3] > best[3]:
            best = tup

    if best and best[3] > 0.95:
        return {"action": "skip_duplicate", "similarity": round(best[3], 4), "existing_id": best[0], "fact": fact.content}

    supersedes_id = None
    if best and 0.85 <= best[3] <= 0.95:
        contradictory = contradiction_check(best[1], fact.content, model=model)
        if contradictory:
            supersedes_id = best[0]

    if dry_run:
        return {
            "action": "would_insert_superseding" if supersedes_id else "would_insert",
            "supersedes_id": supersedes_id,
            "similarity": round(best[3], 4) if best else None,
            "fact": fact.content,
        }

    # Mark old fact superseded if needed.
    if supersedes_id:
        psql(f"UPDATE cortana_memory_semantic SET active=FALSE, superseded_at=NOW() WHERE id={supersedes_id};")

    tags_json = json.dumps(fact.tags)
    people_json = json.dumps(fact.people)
    metadata = json.dumps({
        "atomic_fact": True,
        "importance": fact.importance,
        "tags": fact.tags,
        "people": fact.people,
        "extracted_via": "ollama",
    })

    insert_sql = f"""
INSERT INTO cortana_memory_semantic (
  fact_type, subject, predicate, object_value,
  confidence, trust, stability,
  first_seen_at, last_seen_at,
  source_type, source_ref, fingerprint,
  metadata, embedding_local, embedding_model,
  extraction_source, supersedes_id
)
VALUES (
  {_q(fact.fact_type)},
  'hamel',
  'stated',
  {_q(fact.content)},
  {fact.confidence:.3f},
  {max(0.5, min(1.0, fact.confidence)):.3f},
  {max(0.4, min(1.0, fact.importance)):.3f},
  NOW(), NOW(),
  'atomic_extraction',
  {_q(source)},
  md5({_q(fact.fact_type + '|' + fact.content)}),
  { _q(metadata) }::jsonb || jsonb_build_object('tags', { _q(tags_json) }::jsonb, 'people', { _q(people_json) }::jsonb),
  {vec_sql}::vector,
  'BAAI/bge-small-en-v1.5',
  {_q(source)},
  {str(supersedes_id) if supersedes_id else 'NULL'}
)
ON CONFLICT (fact_type, subject, predicate, object_value)
DO UPDATE SET
  last_seen_at = EXCLUDED.last_seen_at,
  confidence = GREATEST(cortana_memory_semantic.confidence, EXCLUDED.confidence),
  extraction_source = EXCLUDED.extraction_source,
  metadata = cortana_memory_semantic.metadata || EXCLUDED.metadata
RETURNING id;
"""
    new_id = psql(insert_sql, capture=True).strip()

    return {
        "action": "insert_superseding" if supersedes_id else "insert",
        "id": int(new_id) if new_id else None,
        "supersedes_id": supersedes_id,
        "similarity": round(best[3], 4) if best else None,
        "fact": fact.content,
    }


def collect_texts(from_file: str | None, from_dir: str | None, since_days: int | None, direct_text: str | None) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    if direct_text:
        items.append(("inline_text", direct_text))

    if from_file:
        p = Path(from_file)
        if not p.exists():
            raise FileNotFoundError(f"File not found: {from_file}")
        items.append((str(p), p.read_text(encoding="utf-8", errors="ignore")))

    if from_dir:
        d = Path(from_dir)
        if not d.is_dir():
            raise NotADirectoryError(from_dir)
        cutoff = datetime.now(timezone.utc) - timedelta(days=(since_days or 1_000_000))
        for path in sorted(d.glob("*.md")):
            if datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc) < cutoff:
                continue
            items.append((str(path), path.read_text(encoding="utf-8", errors="ignore")))

    if not items:
        stdin_data = sys.stdin.read().strip()
        if stdin_data:
            items.append(("stdin", stdin_data))

    if not items:
        raise SystemExit("No input provided. Use --text, --from-file, --from-dir, or stdin.")

    return items


def run_extract(args: argparse.Namespace) -> None:
    ensure_schema()

    inputs = collect_texts(args.from_file, args.from_dir, args.since_days, args.text)
    all_results: list[dict[str, Any]] = []
    manual_reviews: list[str] = []

    for source, text in inputs:
        facts, fallback = extract_facts(text, source=source, model=args.model)
        if fallback:
            manual_reviews.append(fallback)
            continue

        for fact in facts:
            result = dedupe_and_store(fact, source=source, model=args.model, dry_run=args.dry_run)
            all_results.append(result)

    output = {
        "ok": True,
        "dry_run": args.dry_run,
        "processed_sources": [s for s, _ in inputs],
        "results": all_results,
        "manual_review_count": len(manual_reviews),
    }
    print(json.dumps(output, indent=2))

    if manual_reviews:
        review_dir = WORKSPACE / "tmp" / "fact-extraction-manual-review"
        review_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        out_file = review_dir / f"manual-review-{stamp}.md"
        out_file.write_text("\n\n---\n\n".join(manual_reviews), encoding="utf-8")
        print(f"\nManual review template written to: {out_file}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Atomic fact extraction pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    p_extract = sub.add_parser("extract", help="Extract atomic facts and store/dry-run")
    p_extract.add_argument("--text", help="Inline transcript text")
    p_extract.add_argument("--from-file", help="Extract from one file")
    p_extract.add_argument("--from-dir", help="Extract from all .md files in directory")
    p_extract.add_argument("--since-days", type=int, default=None, help="When used with --from-dir, only process files modified in last N days")
    p_extract.add_argument("--model", default="phi3:mini", help="Ollama model")
    p_extract.add_argument("--dry-run", action="store_true", help="Show what would be extracted/stored")
    p_extract.set_defaults(func=run_extract)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
