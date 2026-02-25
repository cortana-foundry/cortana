# earnings-alert

Automated earnings checks/alerts for held positions (plus forever-hold watch: `NVDA`, `TSLA`).

## Files
- `earnings-check.sh` — shell entrypoint (cron-friendly)
- `earnings-check.py` — implementation
- `cache/earnings-calendar.json` — Nasdaq earnings calendar cache

## Data Sources
1. Alpaca local endpoint: `http://localhost:3033/alpaca/portfolio`
2. Nasdaq earnings calendar API (free): `https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD`
3. Nasdaq earnings-surprise + quote info for post-earnings brief
4. Optional fallback support: Alpha Vantage earnings calendar via `ALPHAVANTAGE_API_KEY`

## Usage
```bash
# Morning scan (today/tomorrow)
~/clawd/tools/earnings-alert/earnings-check.sh --mode scan

# T-minus actionable alert text
~/clawd/tools/earnings-alert/earnings-check.sh --mode tminus

# Post-earnings beat/miss summary + AH/PM move
~/clawd/tools/earnings-alert/earnings-check.sh --mode post

# Debug one symbol
~/clawd/tools/earnings-alert/earnings-check.sh --mode check-symbol --symbol NVDA
```

## Output contract
Script prints clean Telegram-ready message text. If no alert is due, output is empty.
