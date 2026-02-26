#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
python3 - <<'PY'
import os,glob,re,json,subprocess,time
from collections import defaultdict
base=os.path.expanduser('~/.openclaw/sessions')
week_ago=time.time()-7*24*3600
sizes=defaultdict(int)
sub_total=0
sub_count=0
for p in glob.glob(base+'/**/*.json',recursive=True):
    try:
        st=os.stat(p)
    except FileNotFoundError:
        continue
    if st.st_mtime<week_ago: continue
    kb=st.st_size/1024.0
    name=os.path.basename(p)
    key='unknown'
    m=re.search(r'cron:([^:]+):run',name)
    if m: key='cron:'+m.group(1)
    sizes[key]+=kb
    if 'subagent' in name:
        sub_total+=kb
        sub_count+=1

top=sorted(sizes.items(), key=lambda x:x[1], reverse=True)[:5]
cron_cost=[{'label':k,'kb':round(v,1),'est_usd':round(v*0.015,2)} for k,v in top]

q="""
SELECT
  COUNT(*) FILTER (
    WHERE lower(coalesce(context::text,'')) LIKE '%respond%'
       OR lower(signal_type) LIKE '%reply%'
       OR lower(signal_type) LIKE '%engage%'
  )::float,
  COUNT(*)::float
FROM cortana_feedback_signals
WHERE (lower(signal_type) LIKE '%brief%' OR lower(coalesce(related_rule,'')) LIKE '%brief%')
  AND timestamp > NOW()-INTERVAL '7 days';
"""
brief_num=0.0; brief_den=0.0
try:
    out=subprocess.check_output(['psql','cortana','-t','-A','-F',',','-c',q],text=True).strip()
    if out:
        a,b=(out.split(',')+['0','0'])[:2]
        brief_num=float(a or 0); brief_den=float(b or 0)
except Exception:
    pass
rate=(brief_num/brief_den) if brief_den else None
print(json.dumps({
  'analysis_date': time.strftime('%Y-%m-%d'),
  'top_cost_crons': cron_cost,
  'subagent_cost_7d': {'sessions':sub_count,'est_usd': round(sub_total*0.015,2)},
  'brief_engagement_rate': rate
},separators=(',',':')))
PY
