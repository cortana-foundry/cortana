#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="${REPO_ROOT:-}"
BASE_REF="${BASE_REF:-}"
HEAD_REF="${HEAD_REF:-HEAD}"
FORCE=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage:
  sync-memory-wiki-if-needed.sh [--repo-root <path>] [--base-ref <ref>] [--head-ref <ref>] [--force] [--dry-run]

Behavior:
  - checks a repo diff for curated wiki source files
  - runs tools/openclaw/sync-memory-wiki.sh only when those files changed
  - supports both cortana and cortana-external repo roots
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-root)
      REPO_ROOT="$2"
      shift 2
      ;;
    --base-ref)
      BASE_REF="$2"
      shift 2
      ;;
    --head-ref)
      HEAD_REF="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)"
fi

if [[ -z "$REPO_ROOT" || ! -d "$REPO_ROOT/.git" ]]; then
  echo "repo root missing or not a git repo: ${REPO_ROOT:-<empty>}" >&2
  exit 1
fi

resolve_default_base_ref() {
  local repo="$1"
  if git -C "$repo" rev-parse --verify -q ORIG_HEAD >/dev/null 2>&1; then
    printf 'ORIG_HEAD'
    return
  fi
  if git -C "$repo" rev-parse --verify -q 'HEAD@{1}' >/dev/null 2>&1; then
    printf 'HEAD@{1}'
    return
  fi
  printf 'HEAD'
}

if [[ -z "$BASE_REF" ]]; then
  BASE_REF="$(resolve_default_base_ref "$REPO_ROOT")"
fi

repo_name="$(basename "$REPO_ROOT")"
case "$repo_name" in
  cortana|cortana-external)
    declare -a WATCHED_PATHS=(
      "README.md"
      "docs/README.md"
      "knowledge/indexes/systems.md"
    )
    ;;
  *)
    echo "unsupported repo for memory wiki sync gate: $REPO_ROOT" >&2
    exit 1
    ;;
esac

if [[ "$FORCE" == true ]]; then
  echo "[memory-wiki] force=true repo=$REPO_ROOT"
  if [[ "$DRY_RUN" == true ]]; then
    echo "[memory-wiki] dry-run would execute $ROOT/tools/openclaw/sync-memory-wiki.sh"
    exit 0
  fi
  exec "$ROOT/tools/openclaw/sync-memory-wiki.sh"
fi

changed_files="$(
  git -C "$REPO_ROOT" diff --name-only "$BASE_REF" "$HEAD_REF" -- "${WATCHED_PATHS[@]}" || true
)"

if [[ -z "$changed_files" ]]; then
  echo "[memory-wiki] skip repo=$REPO_ROOT base=$BASE_REF head=$HEAD_REF no curated wiki source changes"
  exit 0
fi

echo "[memory-wiki] trigger repo=$REPO_ROOT base=$BASE_REF head=$HEAD_REF"
printf '%s\n' "$changed_files"

if [[ "$DRY_RUN" == true ]]; then
  echo "[memory-wiki] dry-run would execute $ROOT/tools/openclaw/sync-memory-wiki.sh"
  exit 0
fi

exec "$ROOT/tools/openclaw/sync-memory-wiki.sh"
