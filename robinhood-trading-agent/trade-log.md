# Trade Log

Append-only audit trail. The agent writes one row per cycle decision —
including decisions to skip a trade. Never edit or delete past rows; if a
rule changes, note it here and let the history stand as a record of what the
strategy actually was at the time.

| Date | Action | Ticker | Signals / Reasoning | Confidence | Size | Stop / Target | Result |
|---|---|---|---|---|---|---|---|
| _(example)_ 2026-06-08 | Skipped | — | No qualifying setup: SPY/QQQ both inside Bollinger bands, no MA crossover, RSI neutral (52, 58) | — | — | — | — |
| 2026-06-25 pre-mkt | SELL queued | BBAI | Stop-loss violation: -14% vs -7% hard limit (avg cost $4.11, last $3.54). Exiting full 7.299447 shares. GFD market order queued for open. | — | 7.299447 sh | Stop triggered | Pending fill |
| 2026-06-25 pre-mkt | SELL queued | LUNR | Stop-loss violation: -35% vs -7% hard limit (avg cost $29.32, last $19.13). Exiting full 0.989089 shares. GFD market order queued for open. | — | 0.989089 sh | Stop triggered | Pending fill |
| 2026-06-25 pre-mkt | SELL queued (trim) | ARM | +17.9% in pre-market vs cost $322.64 — past +15% partial-profit target. Trimming half (0.044942 sh), holding remainder. GFD market order queued for open. | — | 0.044942 sh (half) | Target hit | Pending fill |
| 2026-06-25 pre-mkt | SCAN — BUY pending | IWM | above 50-SMA ($283.37), MACD bullish (+0.269), RSI neutral 58.7. LOW confidence (no volume data for last bar). $2.50 position (~3% acct). BLOCKED: insufficient BP until sells clear at open. | LOW | $2.50 | Stop -7% / Trim +15% | Awaiting BP |
| 2026-06-25 pre-mkt | SCAN — SKIP | JPM | above 50-SMA, MACD bullish BUT RSI 67.4 (approaching overbought threshold of 70 — caution flag). Passed on this cycle. | — | — | — | — |
| 2026-06-25 pre-mkt | SCAN — BUY pending | JNJ | above 50-SMA ($230.20), MACD bullish (+0.403), RSI neutral 59.0. LOW confidence. $2.50 position. BLOCKED: insufficient BP until sells clear at open. | LOW | $2.50 | Stop -7% / Trim +15% | Awaiting BP |
| 2026-06-25 pre-mkt | SCAN — BUY pending | PG | above 50-SMA ($145.58), MACD bullish (+0.396), RSI neutral 58.3. LOW confidence. $2.50 position. BLOCKED: insufficient BP until sells clear at open. | LOW | $2.50 | Stop -7% / Trim +15% | Awaiting BP |
| 2026-06-25 pre-mkt | SCAN — SKIP (bearish) | MSFT,GOOGL,AMZN,NVDA,META,XOM | All below 50-SMA + bearish MACD. No qualifying long setups. | — | — | — | — |
