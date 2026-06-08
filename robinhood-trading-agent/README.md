# Robinhood Agentic Trading Agent

A Claude Code subagent that connects to Robinhood's **Agentic Trading** beta
(`agent.robinhood.com/mcp/trading`) to analyze markets and trade a *dedicated,
isolated* sub-account on your behalf — following a written, rules-based
strategy rather than vibes.

> **This connects to a real brokerage account that can place real trades with
> real money.** Read the whole "Safety" section before connecting anything.

## How the pieces fit together

| File | Purpose |
|---|---|
| `STRATEGY.md` | The rulebook: which chart patterns to trade, hard risk limits, position sizing, and the per-cycle decision workflow. This is the actual "trading logic." |
| `.claude/agents/robinhood-trader.md` | The Claude Code subagent persona. It reads `STRATEGY.md` and operates the account through the MCP tools, refusing to break any rule in it. |
| `.mcp.json` | Project-scoped MCP connection to `agent.robinhood.com/mcp/trading`. |
| `watchlist.md` | The fixed set of tickers the agent is allowed to screen (edit this to change the universe). |
| `trade-log.md` | Append-only log the agent writes to — every trade taken *and every trade skipped*, with reasoning. This is your audit trail and the basis for tuning the strategy later. |

## Setup

### 1. Connect your agent in the Robinhood app
In the Robinhood app, go to **Agentic → Connect your agent** (the screen in
the screenshot you shared). Robinhood walks you through creating the
*dedicated sub-account* that's isolated from the rest of your portfolio, and
issues a connection token/credential for your agent.

### 2. Provide the credential to Claude Code
Set it as an environment variable rather than pasting it into any file (the
`.mcp.json` here already references it via `${ROBINHOOD_AGENT_TOKEN}`):

```bash
export ROBINHOOD_AGENT_TOKEN="<the token Robinhood gives you>"
```

> If Robinhood's actual auth flow turns out to be OAuth-based instead of a
> static bearer token (common for brokerage MCP integrations), update the
> `headers` block in `.mcp.json` to match what Robinhood documents for your
> account — the structure here is a starting point, not a guarantee of their
> exact protocol.

### 3. Launch Claude Code from this directory
```bash
cd robinhood-trading-agent
claude
```
Claude Code will pick up `.mcp.json` and `.claude/agents/robinhood-trader.md`
automatically. Approve the MCP connection when prompted.

### 4. Run a cycle
```
> Use the robinhood-trader agent to review the account and run a trading cycle
```
The agent will read `STRATEGY.md`, check account state, manage existing
positions, screen `watchlist.md`, and log every decision (including "did
nothing") to `trade-log.md`.

## Customizing the strategy

Everything the agent is and isn't allowed to do lives in `STRATEGY.md` — edit
the indicator thresholds, risk limits, or workflow there; you don't need to
touch the agent definition itself. Treat changes to Section 2 (hard risk
limits) with real care: those numbers are what stand between a bad week and a
blown-up account.

## Running it on a schedule

This agent does **not** run itself — each cycle is a Claude Code session you
(or a scheduler) start. Two reasonable options:
- Run it manually once or twice a day, reviewing `trade-log.md` each time.
- Use the `/loop` skill (e.g. `/loop 1h Use the robinhood-trader agent to run
  a trading cycle`) to run it on an interval — but only after you've watched
  it operate manually for a while and trust its judgment and the strategy's
  thresholds.

**Start with the smallest possible amount of capital in the sub-account.**
Robinhood's sub-account isolation (per the screenshot: "trades in a dedicated
account separate from the rest of your portfolio") is exactly the safety net
you want here — use it, and fund it conservatively while you evaluate
real-world performance.

## Safety notes (read before connecting a funded account)

- **This is not financial advice and not a guaranteed money-maker.**
  Pattern-based systematic trading can and will lose money on individual
  trades — the strategy is designed to keep losses small and bounded, not to
  eliminate them.
- **The hard limits in `STRATEGY.md` §2 are your real protection** — position
  size caps, stop losses, a daily loss circuit breaker, a daily trade cap, and
  a cash floor. The agent is instructed to treat these as absolute, but *you*
  are the one who should sanity-check them against how much you're actually
  willing to risk before funding the account.
- **Watch the first several cycles closely.** Don't walk away and assume it's
  working. Read `trade-log.md` after every run.
- **You can disconnect at any time** from the Robinhood app's Agentic screen —
  do this immediately if you see behavior that doesn't match `STRATEGY.md`.
