# Watchlist

The agent only screens tickers listed here (per `STRATEGY.md` §2.1: liquid,
large-cap US stocks and ETFs — no penny stocks, no low-volume names). Edit
this list to change the universe; keep it small enough that the agent can
analyze every name thoroughly each cycle rather than skimming a long list.

## Broad market ETFs
- SPY — S&P 500
- QQQ — Nasdaq 100
- DIA — Dow Jones Industrial Average
- IWM — Russell 2000

## Large-cap tech
- AAPL — Apple
- MSFT — Microsoft
- GOOGL — Alphabet
- AMZN — Amazon
- NVDA — NVIDIA
- META — Meta Platforms

## Other liquid large-caps (sector diversification)
- JPM — JPMorgan Chase (financials)
- JNJ — Johnson & Johnson (healthcare)
- XOM — Exxon Mobil (energy)
- PG — Procter & Gamble (consumer staples)

---
Notes:
- Keep an eye on the §2.7 sector-concentration cap when you add names —
  loading the list with six tech tickers makes that limit easy to trip.
- Remove a ticker here if you don't want the agent to ever consider it,
  regardless of how good a setup looks.
