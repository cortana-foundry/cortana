# market-intel

Unified market intelligence pipeline combining:
- `bird` (X/Twitter sentiment and key account flow)
- `stock-analysis` (quote pull)
- `markets` skill (market open/close status)
- Schwab-backed market context from `cortana-external`

This README documents the source repo layout. Legacy callers can still resolve the same relative paths via the `/Users/hd/openclaw` compatibility shim.

## Location
- Script: `tools/market-intel/market-intel.sh`
- Python engine: `tools/market-intel/market-intel.py`

## Modes

### 1) Single ticker deep dive
```bash
tools/market-intel/market-intel.sh --ticker NVDA
```
Output includes:
- Quote + daily move signal
- Key fundamentals (market cap, P/E, forward P/E, EPS)
- X sentiment scan from latest 20 cashtag tweets
- Notable mentions from `@unusual_whales` and `@DeItaone`

### 2) Market pulse
```bash
tools/market-intel/market-intel.sh --pulse
```
- Market status from `skills/markets/check_market_status.sh`
- Broad X sentiment scan (`stock market today`, `SPY`, `QQQ`)
- Latest flow from `@DeItaone` + `@unusual_whales`
- Top cashtags mentioned

## Notes
- Cashtag queries are escaped as `\$TICKER` so shell expansion does not break searches.
- If bird auth/cookies are unavailable, script still runs and reports missing social data gracefully.
- Output is plain text and Telegram-paste friendly.

## Stock Market Brief Collector

The cron-facing stock market brief now uses a collect-and-summarize split:

```bash
npx tsx /Users/hd/Developer/cortana/tools/market-intel/stock-market-brief-collect.ts
```

What it does:
- runs the Python market snapshot exporter in `/Users/hd/Developer/cortana-external/backtester`
- writes `/tmp/cron-stock-market-brief.json`
- stamps the artifact with a real market session label:
  - `PREMARKET`
  - `OPEN`
  - `AFTER_HOURS`
  - `CLOSED`

What it does not do:
- no portfolio section yet
- no Alpaca dependency
- no Telegram delivery; this is compute only

## Quick test
```bash
tools/market-intel/market-intel.sh --ticker AAPL
tools/market-intel/market-intel.sh --portfolio
tools/market-intel/market-intel.sh --pulse
```
