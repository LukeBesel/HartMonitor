# Trading Strategy & Risk Rules

This document is the "rulebook" the agent must follow. It exists separately from
the agent's system prompt so you can tune thresholds without rewriting the
agent's persona, and so every trade can be traced back to a written rule.

> **The risk rules in Section 2 are hard limits, not suggestions.** If a rule
> and an opportunity conflict, the rule wins. No exceptions, no overrides.

## 1. Patterns the agent looks for

The agent should only act when **at least two independent signals agree**
(confluence). A single indicator is treated as noise.

### Trend signals
- **Moving average crossover**: 20-period SMA crosses above/below the
  50-period SMA on the daily chart ("golden cross" = bullish, "death cross" =
  bearish).
- **Higher highs / higher lows** (uptrend) or **lower highs / lower lows**
  (downtrend) over the last 10-20 sessions.

### Momentum signals
- **RSI(14)**: below 30 = oversold (potential bounce), above 70 = overbought
  (potential pullback). Treat as a *reversal warning*, not a standalone buy/sell
  trigger.
- **MACD**: signal-line crossover in the direction of the prevailing trend
  strengthens a trend signal; crossover against the trend is a caution flag.

### Volatility / breakout signals
- **Bollinger Band squeeze → breakout**: price exits a tightened band with
  rising volume.
- **Support/resistance breaks**: price closes beyond a level that has held at
  least twice in the last 60 sessions, on above-average volume.

### Volume confirmation
- A price move on volume **>1.5x the 20-day average volume** is considered
  confirmed; the same move on light volume is considered suspect and should
  lower confidence, not raise it.

### Confidence scoring (used for position sizing, see §3)
| Confluence | Confidence |
|---|---|
| 2 agreeing signals, average/low volume | Low |
| 2 agreeing signals + volume confirmation | Medium |
| 3+ agreeing signals + volume confirmation | High |

## 2. Hard risk limits (never violate these)

1. **Universe**: Only trade liquid US-listed common stocks and ETFs with
   average daily volume above 1M shares and share price above $5. No options,
   no futures, no margin/leverage, no penny stocks, no crypto via this agent.
2. **Position size**: A single position may never exceed **10% of the agent's
   account value** at the time of purchase, regardless of confidence.
3. **Per-trade stop loss**: Every position is opened with a mental (or
   broker-side, if supported) stop at **-7% from entry**. If price hits it,
   exit — do not "wait for it to come back."
4. **Per-trade target / trim**: Take partial profit (trim ~half) at **+15%**
   and trail a stop on the remainder.
5. **Daily loss circuit breaker**: If the account is down **3% on the day**,
   stop opening new positions for the rest of that trading day.
6. **Daily trade cap**: No more than **5 new positions opened per day**, to
   avoid overtrading/churn and fee drag.
7. **Concentration cap**: No more than **30% of the account** in a single
   sector at any time.
8. **Cash floor**: Always keep at least **15% of the account in cash** as a
   buffer — never go "all in."
9. **No averaging down**: Never add to a losing position to lower the average
   cost basis. That is not a pattern-based decision; it's a justification for a
   mistake.
10. **No earnings-date entries**: Do not open a new position in the 2 trading
    days surrounding a company's scheduled earnings release — that is a binary
    volatility event, not a pattern trade.

## 3. Position sizing (ties confidence to §2 limits)

Position size is the **smaller of**:
- the §2.2 cap (10% of account), and
- a confidence-scaled size: Low → 2-3% of account, Medium → 4-6%, High → up to
  10%.

Never round up to the cap "because it feels right." Confidence is evidence-based,
not a vibe.

## 4. Decision workflow (run this every cycle)

1. **Pull account state** via the MCP tools: cash balance, current positions,
   day's P&L. Check the circuit breaker (§2.5) and cash floor (§2.8) first —
   if either is tripped, do not evaluate new entries this cycle (existing
   positions can still be managed/exited).
2. **Screen the watchlist** (see `watchlist.md` if present, otherwise a small,
   fixed set of liquid large-caps/ETFs — do not chase random tickers).
3. **For each candidate**: gather price/volume history via MCP market-data
   tools, compute the signals in §1, and score confluence/confidence.
4. **For existing positions**: check whether stop-loss, take-profit, or a
   trend-reversal signal now applies, and exit/trim accordingly. Managing
   existing risk always takes priority over opening new positions.
5. **For new entries that clear every §2 limit**: size the position per §3,
   place the order through the MCP trading tools, and write down *why* (which
   signals fired, confidence level, size, stop, target) in the trade log.
6. **Log everything** — winners, losers, and trades you decided *not* to make
   and why. The log is what lets you improve the rules over time.

## 5. What "good" looks like

This strategy will not win every trade — it is built to **lose small and let
winners run**, while never risking account-blowing amounts on a single idea.
If a cycle finds zero qualifying setups, doing nothing is the correct output.
"I found nothing that meets the bar today" is a valid and often-correct answer.
