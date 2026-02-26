#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTFOLIO_URL="${PORTFOLIO_URL:-http://localhost:3033/alpaca/portfolio}"
POSITIONS_FILE="${POSITIONS_FILE:-$SCRIPT_DIR/held-positions.json}"
DB_NAME="${DB_NAME:-cortana}"
TZ_NAME="${TZ_NAME:-America/New_York}"
SOURCE="post-earnings-brief.sh"
PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
if [[ -z "$PSQL_BIN" ]] && [[ -x "/opt/homebrew/opt/postgresql@17/bin/psql" ]]; then
  PSQL_BIN="/opt/homebrew/opt/postgresql@17/bin/psql"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo '{"error":"python3 is required"}'
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo '{"error":"jq is required"}'
  exit 1
fi

esc_sql() {
  printf "%s" "$1" | sed "s/'/''/g"
}

log_event() {
  local sev="$1"
  local msg="$2"
  local meta="$3"

  if [[ -z "$PSQL_BIN" ]]; then
    return 0
  fi

  local esc_msg esc_meta
  esc_msg="$(esc_sql "$msg")"
  esc_meta="$(esc_sql "$meta")"

  "$PSQL_BIN" "$DB_NAME" -c "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('post_earnings_brief', '$SOURCE', '$sev', '$esc_msg', '$esc_meta'::jsonb);" >/dev/null 2>&1 || true
}

REPORT_JSON="$(python3 - "$PORTFOLIO_URL" "$POSITIONS_FILE" "$TZ_NAME" <<'PY'
import json
import sys
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

portfolio_url = sys.argv[1]
positions_file = sys.argv[2]
tz_name = sys.argv[3]
ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(tz_name)
except Exception:
    tz = None

now = datetime.now(tz) if tz else datetime.now()
window_start = now - timedelta(hours=24)


def http_json(url: str, headers=None, timeout=25):
    req = Request(url, headers=headers or {"User-Agent": ua, "Accept": "application/json, text/plain, */*"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def parse_date(value):
    if not value:
        return None
    value = str(value).strip()
    fmts = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%b %d, %Y",
        "%B %d, %Y",
    ]
    for fmt in fmts:
        try:
            d = datetime.strptime(value, fmt)
            if tz:
                return d.replace(tzinfo=tz)
            return d
        except ValueError:
            pass
    return None


def clean_num(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s.lower() in {"n/a", "na", "null", "none", "--"}:
        return None
    s = s.replace("$", "").replace(",", "").replace("%", "")
    try:
        return float(s)
    except ValueError:
        return None


def fmt_money(v):
    n = clean_num(v)
    if n is None:
        return "N/A"
    if abs(n) >= 1_000_000_000:
        return f"${n/1_000_000_000:.2f}B"
    if abs(n) >= 1_000_000:
        return f"${n/1_000_000:.2f}M"
    return f"${n:,.2f}"


def fmt_eps(v):
    n = clean_num(v)
    if n is None:
        return "N/A"
    return f"{n:.2f}"


def fmt_pct(v):
    n = clean_num(v)
    if n is None:
        return "N/A"
    sign = "+" if n > 0 else ""
    return f"{sign}{n:.2f}%"


def load_symbols():
    # Primary: Alpaca portfolio endpoint
    try:
        p = http_json(portfolio_url)
        symbols = sorted({(x.get("symbol") or "").upper() for x in p.get("positions", []) if x.get("symbol")})
        if symbols:
            return symbols, "alpaca"
    except Exception:
        pass

    # Fallback: local config file
    try:
        with open(positions_file, "r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            if isinstance(raw.get("positions"), list):
                vals = raw["positions"]
            elif isinstance(raw.get("symbols"), list):
                vals = raw["symbols"]
            else:
                vals = []
        elif isinstance(raw, list):
            vals = raw
        else:
            vals = []

        symbols = []
        for item in vals:
            if isinstance(item, str):
                s = item.strip().upper()
            elif isinstance(item, dict):
                s = (item.get("symbol") or "").strip().upper()
            else:
                s = ""
            if s:
                symbols.append(s)

        symbols = sorted(set(symbols))
        if symbols:
            return symbols, "config"
    except Exception:
        pass

    return [], "none"


def fetch_nasdaq_surprise(symbol):
    url = f"https://api.nasdaq.com/api/company/{symbol}/earnings-surprise"
    try:
        data = http_json(url, headers={"User-Agent": ua, "Accept": "application/json, text/plain, */*", "Referer": "https://www.nasdaq.com/"})
        rows = data.get("data", {}).get("earningsSurpriseTable", {}).get("rows", [])
        latest = rows[0] if rows else {}
        return {
            "earnings_date": latest.get("dateReported"),
            "quarter": latest.get("fiscalQtrEnd"),
            "eps_actual": latest.get("eps"),
            "eps_estimate": latest.get("consensusForecast"),
            "surprise_pct": latest.get("percentageSurprise"),
            "source": "nasdaq",
        }
    except Exception:
        return {
            "earnings_date": None,
            "quarter": None,
            "eps_actual": None,
            "eps_estimate": None,
            "surprise_pct": None,
            "source": "nasdaq",
        }


def fetch_price_move(symbol):
    url = f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass=stocks"
    try:
        q = http_json(url, headers={"User-Agent": ua, "Accept": "application/json, text/plain, */*", "Referer": "https://www.nasdaq.com/"}).get("data", {})
        market = (q.get("marketStatus") or "").strip()
        primary = q.get("primaryData") or {}
        secondary = q.get("secondaryData") or {}

        market_l = market.lower()
        if "after" in market_l or "pre" in market_l:
            move = primary.get("percentageChange") or secondary.get("percentageChange")
        else:
            move = secondary.get("percentageChange") or primary.get("percentageChange")

        return {
            "market_status": market,
            "move_pct": move,
            "last_price": primary.get("lastSalePrice") or secondary.get("lastSalePrice"),
        }
    except Exception:
        return {"market_status": None, "move_pct": None, "last_price": None}


def fetch_finnhub(symbol):
    import os
    key = (os.getenv("FINNHUB_API_KEY") or "").strip()
    if not key:
        return None

    from_date = (now - timedelta(days=3)).date().isoformat()
    to_date = now.date().isoformat()
    url = f"https://finnhub.io/api/v1/calendar/earnings?symbol={symbol}&from={from_date}&to={to_date}&token={key}"
    try:
        j = http_json(url)
        rows = j.get("earningsCalendar") or []
        if not rows:
            return None
        latest = rows[-1]
        return {
            "earnings_date": latest.get("date"),
            "eps_actual": latest.get("epsActual"),
            "eps_estimate": latest.get("epsEstimate"),
            "revenue_actual": latest.get("revenueActual"),
            "revenue_estimate": latest.get("revenueEstimate"),
            "hour": latest.get("hour"),
            "source": "finnhub",
        }
    except Exception:
        return None


symbols, symbol_source = load_symbols()
items = []

for symbol in symbols:
    nas = fetch_nasdaq_surprise(symbol)
    fin = fetch_finnhub(symbol)
    px = fetch_price_move(symbol)

    earnings_date_raw = (fin or {}).get("earnings_date") or nas.get("earnings_date")
    earnings_dt = parse_date(earnings_date_raw)

    if not earnings_dt:
        continue

    # Date-only sources are interpreted in local market timezone.
    if earnings_dt < window_start or earnings_dt > now:
        continue

    eps_actual = (fin or {}).get("eps_actual") if fin else nas.get("eps_actual")
    eps_estimate = (fin or {}).get("eps_estimate") if fin else nas.get("eps_estimate")

    report = {
        "ticker": symbol,
        "earnings_date": earnings_dt.date().isoformat(),
        "quarter": nas.get("quarter"),
        "eps_actual": eps_actual,
        "eps_estimate": eps_estimate,
        "eps_result": "beat" if (clean_num(eps_actual) is not None and clean_num(eps_estimate) is not None and clean_num(eps_actual) > clean_num(eps_estimate)) else ("miss" if (clean_num(eps_actual) is not None and clean_num(eps_estimate) is not None and clean_num(eps_actual) < clean_num(eps_estimate)) else "unknown"),
        "revenue_actual": (fin or {}).get("revenue_actual") if fin else None,
        "revenue_estimate": (fin or {}).get("revenue_estimate") if fin else None,
        "stock_move_pct": px.get("move_pct"),
        "market_status": px.get("market_status"),
        "last_price": px.get("last_price"),
        "data_sources": {
            "earnings": "finnhub" if fin else nas.get("source"),
            "price": "nasdaq_quote",
        },
    }
    items.append(report)

items.sort(key=lambda x: x["ticker"])

if items:
    lines = ["📊 Post-earnings brief (last 24h)"]
    for r in items:
        lines.append(
            f"• {r['ticker']} ({r['earnings_date']}): EPS {fmt_eps(r.get('eps_actual'))} vs {fmt_eps(r.get('eps_estimate'))} ({r.get('eps_result','unknown')}); "
            f"Revenue {fmt_money(r.get('revenue_actual'))} vs {fmt_money(r.get('revenue_estimate'))}; Move {fmt_pct(r.get('stock_move_pct'))}"
        )
    summary = "\n".join(lines)
else:
    summary = "📊 Post-earnings brief: no held positions with earnings reported in the last 24h."

result = {
    "generated_at": now.isoformat(),
    "window_hours": 24,
    "position_source": symbol_source,
    "positions_checked": symbols,
    "reports": items,
    "telegram_summary": summary,
}

print(json.dumps(result, indent=2))
PY
)"

if [[ -z "$REPORT_JSON" ]]; then
  REPORT_JSON='{"generated_at":null,"reports":[],"telegram_summary":"Post-earnings brief failed: empty report."}'
fi

# Log summary event to cortana_events (best effort)
count="$(echo "$REPORT_JSON" | jq -r '.reports | length' 2>/dev/null || echo 0)"
source_kind="$(echo "$REPORT_JSON" | jq -r '.position_source // "unknown"' 2>/dev/null || echo unknown)"
meta="$(echo "$REPORT_JSON" | jq -c '{reports_count:(.reports|length), tickers:[.reports[].ticker], position_source}' 2>/dev/null || echo '{"reports_count":0}')"

if [[ "$count" =~ ^[0-9]+$ ]] && [[ "$count" -gt 0 ]]; then
  log_event "info" "Post-earnings brief generated for ${count} ticker(s)." "$meta"
else
  log_event "info" "Post-earnings brief generated with no qualifying earnings in last 24h." "$meta"
fi

# Output structured JSON report
printf '%s\n' "$REPORT_JSON"

# Output Telegram-friendly summary
printf '\n%s\n' "$(echo "$REPORT_JSON" | jq -r '.telegram_summary // ""')"
