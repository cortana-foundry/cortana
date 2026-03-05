#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/hd/openclaw"
NAMESPACES=(main researcher huragok)
FILES=(SOUL.md USER.md HEARTBEAT.md MEMORY.md IDENTITY.md)

for ns in "${NAMESPACES[@]}"; do
  base="$ROOT/identities/$ns"
  mkdir -p "$base/memory" "$base/workspace"
  for f in "${FILES[@]}"; do
    target="$base/$f"
    if [[ -f "$target" ]]; then
      continue
    fi

    if [[ "$ns" == "main" && -f "$ROOT/$f" ]]; then
      cp "$ROOT/$f" "$target"
    else
      cat > "$target" <<EOF
# $f — $ns

Auto-generated fallback for missing namespace file.
EOF
    fi
  done

done

echo "identity namespace check complete"
