#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
TODAY="$(date +%Y-%m-%d)"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
whoop_file="$tmpdir/whoop.json"
tonal_file="$tmpdir/tonal.json"

curl -s --max-time 10 http://localhost:3033/whoop/data > "$whoop_file" || echo '{}' > "$whoop_file"
ton_health="$(curl -s --max-time 5 http://localhost:3033/tonal/health 2>/dev/null || true)"
if echo "$ton_health" | grep -qi 'healthy'; then
  curl -s --max-time 10 http://localhost:3033/tonal/data > "$tonal_file" || echo '{}' > "$tonal_file"
else
  echo '{}' > "$tonal_file"
fi

python3 - <<'PY' "$TODAY" "$whoop_file" "$tonal_file"
import json,sys

today=sys.argv[1]
try:
    with open(sys.argv[2]) as f: w=json.load(f)
except:
    w={}
try:
    with open(sys.argv[3]) as f: t=json.load(f)
except:
    t={}

rec_raw=(w.get('recovery') or [{}])[0] if isinstance(w.get('recovery'),list) and w.get('recovery') else {}
slp_raw=(w.get('sleep') or [{}])[0] if isinstance(w.get('sleep'),list) and w.get('sleep') else {}
rec=rec_raw if isinstance(rec_raw,dict) else {}
slp=slp_raw if isinstance(slp_raw,dict) else {}

workouts=[]
raw_workouts = w.get('workouts') if isinstance(w.get('workouts'), list) else []
for x in raw_workouts:
    if not isinstance(x, dict):
        continue
    s=(x.get('start') or '')[:10]
    if s==today:
        score=x.get('score') if isinstance(x.get('score'),dict) else {}
        workouts.append({
            'sport': x.get('sport_name'),
            'strain': score.get('strain')
        })

tonals=[]
raw_tonal = t.get('workouts') if isinstance(t.get('workouts'), list) else []
for x in raw_tonal:
    if not isinstance(x, dict):
        continue
    s=(x.get('beginTime') or '')[:10]
    if s==today:
        stats=x.get('stats') if isinstance(x.get('stats'),dict) else {}
        tonals.append({
            'time': x.get('beginTime'),
            'volume': stats.get('totalVolume')
        })

rec_score = rec.get('score') if isinstance(rec.get('score'),dict) else {}
slp_score = slp.get('score') if isinstance(slp.get('score'),dict) else {}
out={
  'date':today,
  'recovery': {
    'score': rec_score.get('recovery_score', rec.get('score')),
    'hrv': rec_score.get('hrv_rmssd_milli', rec.get('hrv')),
    'rhr': rec_score.get('resting_heart_rate', rec.get('resting_heart_rate'))
  },
  'sleep': {
    'performance': slp_score.get('sleep_performance_percentage', slp.get('performance')),
    'efficiency': slp_score.get('sleep_efficiency_percentage', slp.get('efficiency')),
    'rem_pct': slp_score.get('rem_sleep_percentage', slp.get('rem_percent')),
    'deep_hours': slp_score.get('slow_wave_sleep_duration_in_ms', slp.get('deep_sleep_hours')),
    'rem_hours': slp_score.get('rem_sleep_duration_in_ms', slp.get('rem_sleep_hours'))
  },
  'whoop_workouts_today': workouts[:5],
  'tonal_workouts_today': tonals[:5]
}
print(json.dumps(out,separators=(',',':')))
PY
