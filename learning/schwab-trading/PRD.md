# Schwab Trading Agent — Product Requirements Document

**Author:** Cortana  
**Date:** February 15, 2026  
**Status:** Draft  
**Owner:** Hamel Desai

---

## 1. Overview

Build an autonomous trading agent integrated with Charles Schwab's brokerage API. The agent will monitor positions, analyze market conditions, and execute trades according to predefined strategies with appropriate risk controls.

### 1.1 Vision

A personal AI trading assistant that:
- Monitors portfolio health 24/7
- Surfaces actionable insights proactively
- Executes trades with human approval (initially)
- Graduates to autonomous execution with guardrails
- Learns from outcomes and adapts

### 1.2 Success Metrics

| Metric | Target |
|--------|--------|
| Portfolio visibility | Real-time positions, P&L, alerts |
| Trade execution latency | < 5 seconds from approval |
| Max drawdown (autonomous mode) | Hard cap at 5% daily |
| System uptime | 99%+ during market hours |
| False positive alerts | < 10% |

---

## 2. Phased Rollout

### Phase 1: Read-Only Portfolio Tracking (MVP)

**Timeline:** 1-2 days  
**Risk Level:** None (no trading)

**Features:**
- [ ] Schwab OAuth integration (token storage, refresh flow)
- [ ] Account summary endpoint (balances, buying power)
- [ ] Positions endpoint (holdings, cost basis, P&L)
- [ ] Daily portfolio summary to Telegram (morning brief integration)
- [ ] Price alerts for watchlist stocks (% move thresholds)
- [ ] Earnings calendar integration for held positions

**Deliverables:**
- `schwab_tokens.json` in `~/Desktop/services/`
- New endpoints in existing Go service or standalone
- Telegram notifications via existing message tool

---

### Phase 2: Trade Suggestions + Human Approval

**Timeline:** 1 week  
**Risk Level:** Low (human in the loop)

**Features:**
- [ ] Technical analysis signals (RSI, MACD, moving averages)
- [ ] News sentiment integration (earnings, upgrades/downgrades)
- [ ] Trade proposal format:
  ```
  📈 Trade Suggestion: BUY AAPL
  
  Signal: RSI oversold (28) + positive earnings surprise
  Entry: $185.50 (current: $184.20)
  Position size: 10 shares ($1,855)
  Stop loss: $178 (-4%)
  Target: $195 (+5.7%)
  
  [✅ Approve] [❌ Reject] [✏️ Modify]
  ```
- [ ] Inline button approval via Telegram
- [ ] Order execution on approval
- [ ] Confirmation message with fill details
- [ ] Full audit trail in `cortana_events`

**Deliverables:**
- Trade suggestion engine (Oracle agent integration?)
- Order execution module
- Telegram inline button handlers

---

### Phase 3: Autonomous Trading with Guardrails

**Timeline:** 2-4 weeks  
**Risk Level:** Medium-High (requires extensive testing)

**Features:**

#### 3.1 Strategy Framework
- [ ] Strategy plugin architecture (swap strategies without code changes)
- [ ] Initial strategies:
  - Momentum (trend following)
  - Mean reversion (oversold bounces)
  - Earnings plays (pre/post earnings positioning)
- [ ] Strategy backtesting against historical data
- [ ] Paper trading mode (simulated execution, real prices)

#### 3.2 Risk Management (NON-NEGOTIABLE)
- [ ] **Position limits:**
  - Max 10% of portfolio in single position
  - Max 5 open positions at once
- [ ] **Loss limits:**
  - Daily loss limit: 2% of portfolio
  - Weekly loss limit: 5% of portfolio
  - Auto-halt trading on breach
- [ ] **Instrument restrictions:**
  - Stocks only (no options, futures, margin initially)
  - Whitelist of allowed tickers
  - Blacklist of excluded tickers (meme stocks, penny stocks)
- [ ] **Time restrictions:**
  - No trading first/last 15 min of session (volatility)
  - No overnight holds (initially)

#### 3.3 Kill Switches
- [ ] `/trading stop` — immediate halt, no new orders
- [ ] `/trading pause` — pause new orders, manage existing
- [ ] `/trading status` — current state, open orders, P&L
- [ ] Auto-halt on API errors or unexpected behavior
- [ ] Circuit breaker on rapid successive losses

#### 3.4 Observability
- [ ] Real-time P&L dashboard (canvas or web)
- [ ] Trade history with outcomes
- [ ] Strategy performance attribution
- [ ] Daily/weekly performance reports
- [ ] Anomaly detection (unusual fills, slippage)

**Deliverables:**
- Strategy engine with plugin support
- Risk management module
- Paper trading environment
- Kill switch commands
- Performance dashboard

---

## 3. Technical Architecture

### 3.1 Schwab API Integration

**API Details:**
- Portal: developer.schwab.com
- Auth: OAuth 2.0 (similar to Whoop/Tonal)
- Rate limits: ~120 requests/minute
- Endpoints needed:
  - `/accounts` — account info, balances
  - `/accounts/{id}/positions` — holdings
  - `/accounts/{id}/orders` — order management
  - `/marketdata/quotes` — real-time quotes
  - `/marketdata/chains` — options chains (future)

**Token Management:**
- Store: `~/Desktop/services/schwab_tokens.json`
- Auto-refresh on expiry
- Self-healing: delete tokens on auth failure (same pattern as Tonal)

### 3.2 Service Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Cortana (Main)                      │
│  - Morning briefs with portfolio summary                │
│  - Trade approval via Telegram                          │
│  - /trading commands                                    │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│              Trading Service (Go/Python)                │
│  - Schwab API client                                    │
│  - Strategy engine                                      │
│  - Risk management                                      │
│  - Order execution                                      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│                   Schwab API                            │
└─────────────────────────────────────────────────────────┘
```

### 3.3 Data Storage

| Data | Location |
|------|----------|
| Auth tokens | `~/Desktop/services/schwab_tokens.json` |
| Trade history | `cortana_events` (PostgreSQL) |
| Strategy config | `~/clawd/config/trading/strategies.yaml` |
| Watchlist | `cortana_watchlist` (PostgreSQL) |
| Backtest results | `~/clawd/memory/trading/backtests/` |

---

## 4. Safety & Compliance

### 4.1 Never Automated (Human Only)
- Enabling/disabling autonomous mode
- Changing risk limits
- Adding funds or withdrawals
- Tax-related decisions (wash sales, etc.)

### 4.2 Audit Requirements
- Every order logged with timestamp, rationale, outcome
- Daily P&L reconciliation
- Weekly strategy performance review
- Monthly full audit export

### 4.3 Regulatory Notes
- Pattern Day Trader rules (>4 day trades in 5 days = $25k min)
- Wash sale tracking for tax purposes
- No insider trading signals (duh)

---

## 5. Open Questions

1. **Account type:** Cash or margin account?
2. **Initial capital allocation:** How much to start with?
3. **Trading style preference:** Conservative (few trades, high conviction) or active?
4. **Holdings to protect:** Any positions that should NEVER be sold? (TSLA, NVDA = forever holds per MEMORY.md)
5. **Preferred strategies:** Momentum? Value? Earnings plays?
6. **Paper trading duration:** How long before going live?

---

## 6. Implementation Checklist

### Phase 1 Kickoff
- [ ] Register on developer.schwab.com
- [ ] Create app, get client ID/secret
- [ ] Implement OAuth flow
- [ ] Test account/positions endpoints
- [ ] Add to morning brief
- [ ] Set up price alerts

### Phase 2 Kickoff
- [ ] Design trade suggestion format
- [ ] Implement inline button approval
- [ ] Build order execution module
- [ ] Test with small position
- [ ] Run for 2 weeks in approval mode

### Phase 3 Kickoff
- [ ] Build paper trading mode
- [ ] Implement first strategy
- [ ] Build risk management module
- [ ] Run paper trading for 1 month
- [ ] Graduate to small real positions

---

## 7. References

- [Schwab Developer Portal](https://developer.schwab.com)
- [Schwab API Docs](https://developer.schwab.com/products/trader-api--individual)
- [Pattern Day Trader Rules](https://www.finra.org/investors/learn-to-invest/advanced-investing/day-trading-margin-requirements-know-rules)
- [Wash Sale Rules](https://www.irs.gov/publications/p550)

---

*Last updated: Feb 15, 2026*
