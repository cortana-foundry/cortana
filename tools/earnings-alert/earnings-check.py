#!/usr/bin/env python3
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CACHE_DIR = Path.home() / "clawd" / "tools" / "earnings-alert" / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CAL_CACHE = CACHE_DIR / "earnings-calendar.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

FOREVER_HOLDS = {"TSLA", "NVDA"}


def http_json(url: str, headers=None, timeout=25):
    req = Request(url, headers=headers or {"User-Agent": UA, "Accept": "application/json, text/plain, */*"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def load_cache():
    if not CAL_CACHE.exists():
        return {"fetched_at": None, "dates": {}}
    try:
        return json.loads(CAL_CACHE.read_text())
    except Exception:
        return {"fetched_at": None, "dates": {}}


def save_cache(cache):
    CAL_CACHE.write_text(json.dumps(cache, indent=2))


def get_alpaca_positions():
    raw = subprocess.check_output(["curl", "-s", "http://localhost:3033/alpaca/portfolio"], text=True)
    data = json.loads(raw)
    symbols = []
    positions = {}
    for p in data.get("positions", []):
        s = (p.get("symbol") or "").upper()
        if not s:
            continue
        symbols.append(s)
        positions[s] = {
            "market_value": p.get("market_value") or p.get("marketValue") or "0",
            "qty": p.get("qty") or p.get("quantity") or "0",
        }
    # Always track forever holds even if currently absent
    for s in FOREVER_HOLDS:
        positions.setdefault(s, {"market_value": "0", "qty": "0"})
    symbols = sorted(set(symbols) | FOREVER_HOLDS)
    return symbols, positions


def fetch_nasdaq_calendar_for_date(date_str: str):
    url = f"https://api.nasdaq.com/api/calendar/earnings?date={date_str}"
    j = http_json(url, headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": "https://www.nasdaq.com/"})
    return j.get("data", {}).get("rows", [])


def fetch_alpha_vantage_calendar(symbol: str):
    key = os.getenv("ALPHAVANTAGE_API_KEY", "").strip()
    if not key:
        return None
    params = urlencode({"function": "EARNINGS_CALENDAR", "symbol": symbol, "horizon": "3month", "apikey": key})
    url = f"https://www.alphavantage.co/query?{params}"
    req = Request(url, headers={"User-Agent": UA})
    try:
        with urlopen(req, timeout=30) as r:
            txt = r.read().decode("utf-8")
    except Exception:
        return None
    # AV returns CSV. Keep ultra-light parse.
    lines = [x.strip() for x in txt.splitlines() if x.strip()]
    if len(lines) < 2:
        return None
    headers = [h.strip() for h in lines[0].split(",")]
    out = []
    for ln in lines[1:]:
        cols = [c.strip() for c in ln.split(",")]
        if len(cols) != len(headers):
            continue
        row = dict(zip(headers, cols))
        if row.get("symbol", "").upper() == symbol.upper():
            out.append(row)
    return out or None


def normalize_time_bucket(time_value: str):
    t = (time_value or "").lower()
    if "after" in t:
        return "after close"
    if "before" in t:
        return "before open"
    if "during" in t:
        return "during market"
    return "time tbd"


def rows_for_dates(dates):
    cache = load_cache()
    now = dt.datetime.now(dt.timezone.utc)
    fetched_at = cache.get("fetched_at")
    stale = True
    if fetched_at:
        try:
            age = now - dt.datetime.fromisoformat(fetched_at)
            stale = age.total_seconds() > 12 * 3600
        except Exception:
            stale = True
    for d in dates:
        if stale or d not in cache.get("dates", {}):
            rows = fetch_nasdaq_calendar_for_date(d)
            cache.setdefault("dates", {})[d] = rows
    cache["fetched_at"] = now.isoformat()
    save_cache(cache)

    merged = []
    for d in dates:
        for r in cache.get("dates", {}).get(d, []):
            rr = dict(r)
            rr["_date"] = d
            merged.append(rr)
    return merged


def index_by_symbol(rows, symbols):
    sset = set(symbols)
    out = {}
    for r in rows:
        sym = (r.get("symbol") or "").upper()
        if sym in sset:
            out[sym] = r
    return out


def get_post_earnings(symbol: str):
    # Nasdaq earnings surprise table (actual vs consensus)
    url = f"https://api.nasdaq.com/api/company/{symbol}/earnings-surprise"
    try:
        j = http_json(url, headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": "https://www.nasdaq.com/"})
        rows = j.get("data", {}).get("earningsSurpriseTable", {}).get("rows", [])
        latest = rows[0] if rows else {}
    except Exception:
        latest = {}

    # AH/PM move via quote info endpoint
    qurl = f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass=stocks"
    try:
        q = http_json(qurl, headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Referer": "https://www.nasdaq.com/"}).get("data", {})
        market = q.get("marketStatus") or ""
        primary = q.get("primaryData") or {}
        secondary = q.get("secondaryData") or {}
        move = primary.get("percentageChange") if "after" in market.lower() or "pre" in market.lower() else secondary.get("percentageChange")
        price = primary.get("lastSalePrice") or secondary.get("lastSalePrice")
    except Exception:
        market, move, price = "", None, None

    return {
        "reported": latest.get("dateReported"),
        "quarter": latest.get("fiscalQtrEnd"),
        "eps_actual": latest.get("eps"),
        "eps_consensus": latest.get("consensusForecast"),
        "surprise_pct": latest.get("percentageSurprise"),
        "market_status": market,
        "move_pct": move,
        "last_price": price,
    }


def moneyish(v):
    s = str(v)
    if s in {"", "None", "null"}:
        return "N/A"
    try:
        n = float(s)
        return f"${n:,.2f}"
    except Exception:
        return s


def mode_scan(symbols, positions):
    today = dt.date.today()
    tomorrow = today + dt.timedelta(days=1)
    rows = rows_for_dates([today.isoformat(), tomorrow.isoformat()])
    by = index_by_symbol(rows, symbols)

    lines = [f"Earnings scan for held/watch symbols ({today.isoformat()} ET)"]
    found = 0
    for s in symbols:
        r = by.get(s)
        if not r:
            continue
        found += 1
        when = "today" if r.get("_date") == today.isoformat() else "tomorrow"
        t = normalize_time_bucket(r.get("time"))
        eps = r.get("epsForecast") or "N/A"
        mv = moneyish(positions.get(s, {}).get("market_value", "0"))
        lines.append(f"- {s}: reports {t} {when}. Position: {mv}. Consensus EPS: {eps}. Revenue est: N/A.")

    if found == 0:
        lines.append("- No earnings today/tomorrow for current held symbols. (Watching TSLA/NVDA regardless.)")

    return "\n".join(lines)


def mode_tminus(symbols, positions):
    today = dt.date.today()
    tomorrow = today + dt.timedelta(days=1)
    rows = rows_for_dates([today.isoformat(), tomorrow.isoformat()])
    by = index_by_symbol(rows, symbols)
    alerts = []

    for s in symbols:
        r = by.get(s)
        if not r:
            continue
        d = r.get("_date")
        t = normalize_time_bucket(r.get("time"))
        eps = r.get("epsForecast") or "N/A"
        mv = moneyish(positions.get(s, {}).get("market_value", "0"))
        if d == today.isoformat() and t == "after close":
            alerts.append(f"⚠️ EARNINGS ALERT: {s} reports after close today. Current position: {mv}. Consensus EPS: {eps}. Revenue est: N/A. Heads up, Chief.")
        elif d == tomorrow.isoformat() and t == "before open":
            alerts.append(f"⚠️ EARNINGS ALERT: {s} reports before open tomorrow. Current position: {mv}. Consensus EPS: {eps}. Revenue est: N/A. Heads up, Chief.")

    return "\n\n".join(alerts)


def mode_post(symbols):
    lines = []
    for s in symbols:
        info = get_post_earnings(s)
        if not info.get("reported"):
            continue
        lines.append(
            f"📊 POST-EARNINGS: {s} ({info.get('quarter')}) reported {info.get('reported')}. "
            f"EPS actual {info.get('eps_actual')} vs consensus {info.get('eps_consensus')} "
            f"({info.get('surprise_pct')}% surprise). "
            f"Price: {info.get('last_price') or 'N/A'} ({info.get('move_pct') or 'N/A'}) {info.get('market_status') or ''}."
        )
    return "\n\n".join(lines)


def mode_check_symbol(symbol: str):
    # Test/fallback helper for quick checks
    symbol = symbol.upper()
    av = fetch_alpha_vantage_calendar(symbol)
    today = dt.date.today().isoformat()
    rows = rows_for_dates([today])
    hit = [r for r in rows if (r.get("symbol") or "").upper() == symbol]
    out = {"symbol": symbol, "nasdaq_today": hit[:1], "alpha_vantage": av[:1] if av else None}
    return json.dumps(out, indent=2)


def main():
    ap = argparse.ArgumentParser(description="Earnings alert checker for held positions")
    ap.add_argument("--mode", choices=["scan", "tminus", "post", "check-symbol"], default="scan")
    ap.add_argument("--symbol", help="used with --mode check-symbol")
    args = ap.parse_args()

    symbols, positions = get_alpaca_positions()

    if args.mode == "scan":
        out = mode_scan(symbols, positions)
    elif args.mode == "tminus":
        out = mode_tminus(symbols, positions)
    elif args.mode == "post":
        out = mode_post(symbols)
    elif args.mode == "check-symbol":
        if not args.symbol:
            print("--symbol required for check-symbol", file=sys.stderr)
            sys.exit(2)
        out = mode_check_symbol(args.symbol)
    else:
        out = ""

    # Output clean message only
    if out.strip():
        print(out.strip())


if __name__ == "__main__":
    main()
