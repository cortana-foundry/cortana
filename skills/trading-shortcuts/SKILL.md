---
name: trading-shortcuts
description: Interpret terse slash-style or short natural-language trading commands for Hamel and route them to the local backtester stack in /Users/hd/Developer/cortana-external/backtester. Use when the user sends commands like /market, /stock NVDA, /quick BTC, /backtest TSLA 2y, /dipscan, /canslim, or asks for local stock research/backtests with minimal wording.
---

# Trading Shortcuts

Use this skill when Hamel wants fast command-style access to the local trading stack.

## Goal

Translate short commands into the correct local workflow, run the command, and return a plain-English trading read.

## Command map

### 1) Market state
Trigger examples:
- `/market`
- `market check`
- `what's the tape`

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python advisor.py --market
```

Reply with:
- regime / tape summary
- whether conditions favor new longs
- one concise action recommendation

### 2) Single-stock research
Trigger examples:
- `/stock NVDA`
- `research AMD`
- `analyze META`

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python advisor.py --symbol <SYMBOL>
```

Reply with:
- buy / watch / no-buy
- why
- key risk
- what would confirm or kill the setup

### 3) Quick verdict
Trigger examples:
- `/quick BTC`
- `quick-check TSLA`
- `quick check ETH`

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python advisor.py --quick-check <SYMBOL>
```

Reply with a short verdict only.

### 4) Legacy backtest
Trigger examples:
- `/backtest NVDA 2y`
- `backtest META for 3 years`
- `compare TSLA vs buy and hold`

Normalize years like:
- `2y` => `2`
- `3 years` => `3`
- default to `2` if omitted and user did not specify another period

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python main.py --symbol <SYMBOL> --years <YEARS> --compare
```

Reply with:
- strategy vs buy-and-hold
- important caveat
- recommendation on whether the result is actually decision-useful

### 5) CANSLIM scan
Trigger examples:
- `/canslim`
- `/canslim 8 6`
- `run canslim`
- `top canslim names`

Defaults:
- `limit=8`
- `min-score=6`

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python canslim_alert.py --limit <LIMIT> --min-score <MIN_SCORE>
```

Reply with the top names and a concise verdict.

### 6) Dip Buyer scan
Trigger examples:
- `/dipscan`
- `/dipscan 8 6`
- `run dip buyer`
- `top dip buyers`

Defaults:
- `limit=8`
- `min-score=6`

Behavior:
- **Default is background / async.** Do not block the chat waiting for Dip Buyer.
- Immediately acknowledge with a short note like: `Running dip scan in the background; I’ll send the shortlist when it’s done.`
- Then run the scan in the background and send the finished result when available.
- Only run Dip Buyer synchronously if Hamel explicitly asks for a live/blocking run.

Run:
```bash
cd /Users/hd/Developer/cortana-external/backtester
source .venv/bin/activate
python dipbuyer_alert.py --limit <LIMIT> --min-score <MIN_SCORE>
```

Final reply should use the scan format:
- **Tape:** <brief regime read if relevant>
- **Top names:** <best few candidates>
- **Verdict:** <what matters right now>
- **Action:** <watch / starter size / stand down>

### 7) Full context / market-intel layer
Trigger examples:
- `/intel`
- `run market intel`
- `use polymarket too`

Run:
```bash
cd /Users/hd/Developer/cortana-external
pnpm install
./tools/market-intel/run_market_intel.sh
```

Then, if needed, return to backtester commands.
Only run this when the user explicitly asks for the extra context layer.

## Parsing rules

- Symbols/tickers should be uppercased in the command you run.
- Keep the reply short by default; expand only if asked.
- If the local venv is missing, tell the user exactly how to bootstrap it.
- If the command fails, report the concrete failure and offer the next fix.
- If both a market regime command and a stock command are requested, do the market check first, then the stock.

## Default response formats

Use one compact format by default.

### Market
- **Tape:** <bullish / mixed / defensive>
- **Verdict:** <favors new longs or not>
- **Action:** <one clear next move>

### Stock / quick check
- **Verdict:** <BUY / WATCH / NO-BUY>
- **Why:** <main reason in one line>
- **Risk:** <main failure mode>
- **Action:** <what Hamel should do next>

### Backtest
- **Result:** <strategy beat / lagged buy-and-hold>
- **Why:** <one-line explanation>
- **Caveat:** <why the test may mislead>
- **Action:** <use it / ignore it / investigate further>

### Scans
- **Tape:** <brief regime read if relevant>
- **Top names:** <best few candidates>
- **Verdict:** <what matters right now>
- **Action:** <watch / starter size / stand down>

Avoid long dumps unless Hamel explicitly asks for the raw output.

## Safety / interpretation

- These commands support research and decision-making; do not present outputs as certainty.
- Separate **pipeline status** from **trading verdict**. A working command can still produce a bad/no-trade signal.
- When a signal conflicts with market regime, say so explicitly.

## Preferred user-facing menu

When Hamel asks what shortcuts exist, give this list:
- `/market` — overall tape / regime check
- `/stock NVDA` — full stock read
- `/quick BTC` — one-line verdict
- `/backtest TSLA 2y` — legacy backtest
- `/canslim` — top CANSLIM names
- `/dipscan` — top Dip Buyer names
- `/intel` — run extra market-intel context
