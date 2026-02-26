#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
python3 - <<'PY'
import json,subprocess

def q(sql):
    try:
        return subprocess.check_output(['psql','cortana','-t','-A','-c',sql],text=True).strip()
    except Exception:
        return ''

current_run=q("SELECT run_id FROM cortana_sitrep ORDER BY timestamp DESC LIMIT 1;")
prev_run=q("SELECT run_id FROM (SELECT DISTINCT run_id, MAX(timestamp) OVER (PARTITION BY run_id) ts FROM cortana_sitrep WHERE run_id != (SELECT run_id FROM cortana_sitrep ORDER BY timestamp DESC LIMIT 1)) t ORDER BY ts DESC LIMIT 1;")

current=q("SELECT json_object_agg(domain||'.'||key,value) FROM cortana_sitrep_latest;")
previous=q(f"SELECT json_object_agg(domain||'.'||key,value) FROM cortana_sitrep WHERE run_id='{prev_run}';") if prev_run else '{}'
recent=q("SELECT json_agg(x) FROM (SELECT title,priority,timestamp FROM cortana_insights ORDER BY timestamp DESC LIMIT 15) x;")

cur=json.loads(current) if current else {}
prev=json.loads(previous) if previous else {}
allow=('calendar.','health.','finance.','tasks.','email.','weather.','system.')
cur={k:v for k,v in cur.items() if k.startswith(allow)}
prev={k:v for k,v in prev.items() if k.startswith(allow)}
# Keep snapshot compact
if len(cur)>40:
  cur=dict(list(cur.items())[:40])
if len(prev)>40:
  prev=dict(list(prev.items())[:40])
print(json.dumps({
  'current_run_id': current_run,
  'previous_run_id': prev_run,
  'current': cur,
  'previous': prev,
  'recent_insights': (json.loads(recent) if recent else [])[:10]
},separators=(',',':')))
PY
