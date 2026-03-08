# Oclay

Autonomous Solana memecoin discovery, analysis, and trading bot with safety-first defaults:

- Discovers new Solana tokens (Helius stream primary, DexScreener fallback)
- Scores tokens for risk/opportunity (authorities, Token-2022 extensions, holder concentration, liquidity/volume, age, route feasibility, basic dev heuristics)
- Runs an autonomous strategy (buy/sell/hold) with risk limits
- Executes swaps via Jupiter Ultra (live mode) or simulates fills (paper mode)
- Continuously monitors open positions and triggers emergency exits (guardian)

This project is **safe-by-default**: live trading is disabled unless you explicitly enable it.

## Requirements
- Node.js 20+
- A Solana RPC endpoint (`SOLANA_RPC_URL`)
  - Note: the public `https://api.mainnet-beta.solana.com` endpoint rate-limits some calls used for safety checks (notably `getTokenLargestAccounts`). For full functionality you will likely need a dedicated RPC provider.
  - If you see 429s, tune the built-in RPC limiter via `RPC_CONCURRENCY`, `RPC_INTERVAL_CAP`, `RPC_INTERVAL_MS` in `.env`.

## Setup
1. Create `.env` from `.env.example` and edit values.
2. Install deps:
   - `npm install`

## Commands
- Primary profile set:
  - `tiny-bankroll` (defensive)
  - `scam-scalp` (default live intent)
  - `growth` (higher upside capture)
- Paper trading with auto dashboard (default):
  - `npm run paper`
- Paper trading with low bankroll profile (about $10-$15 wallet target):
  - `npm run paper:small`
- Paper trading with tiny bankroll hardening profile (recommended for $10-$15):
  - `npm run paper:tiny`
- Paper trading with micro live profile tuned for about `$5` wallet:
  - `npm run paper:5`
- Paper trading with the strict `$40` live-cap profile:
  - `npm run paper:40`
- Paper trading with the ultra guard-rail scam-scalp profile:
  - `npm run paper:scalp`
- Paper trading with the growth profile:
  - `npm run paper:growth`
- Paper trading without dashboard (legacy log stream):
  - `npm run paper -- --no-dashboard`
- Paper trading for a fixed duration:
  - `npm run paper -- --durationSec 60`
- Paper trading with custom dashboard cadence and rows:
  - `npm run paper -- --refreshSec 1 --rows 12`
- Paper dashboard filters/focus:
  - `npm run paper -- --only-failures --focusMint <MINT_PUBKEY>`
  - `npm run paper -- --hide-success --alertsWindowMin 30 --rollupWindowMin 120`
- Desktop dashboard (Electron, observe mode):
  - `npm run desktop`
- Desktop dashboard (Electron, paper workflow attached):
  - `npm run desktop:paper`
- Desktop dashboard (Electron, live workflow attached - requires live env flags):
  - `npm run desktop:live`
- Desktop dashboard fast launch (skips frontend build, assumes `front-end/dist` exists):
  - `npm run desktop:fast`
- Run mode with optional dashboard:
  - `npm run start -- run --dashboard --refreshSec 2 --rows 8`
- Run dashboard with filters:
  - `npm run start -- run --dashboard --only-failures --rows 10`
- Run mode with strict `$40` profile:
  - `npm run run:40 -- --dashboard`
- Run mode with `$5` micro live profile:
  - `npm run run:5 -- --dashboard`
- Run mode with scam-scalp profile:
  - `npm run run:scalp -- --dashboard`
- Run mode with growth profile:
  - `npm run run:growth -- --dashboard`
- Analyze a single mint:
  - `npm run analyze -- --mint <MINT_PUBKEY>`
- Analyze with low bankroll profile:
  - `npm run analyze:small -- --mint <MINT_PUBKEY>`
- Analyze with tiny bankroll profile:
  - `npm run analyze:tiny -- --mint <MINT_PUBKEY>`
- Analyze with `$5` micro live profile:
  - `npm run analyze:5 -- --mint <MINT_PUBKEY>`
- Analyze with `$40` live-cap profile:
  - `npm run analyze:40 -- --mint <MINT_PUBKEY>`
- Analyze with scam-scalp profile:
  - `npm run analyze:scalp -- --mint <MINT_PUBKEY>`
- Analyze with growth profile:
  - `npm run analyze:growth -- --mint <MINT_PUBKEY>`
- Show DB ingestion stats:
  - `npm run stats`
- Show lifecycle latency telemetry:
  - `npm run start -- latency --windowMin 60`
- Show lifecycle latency telemetry (explicit keying mode):
  - `npm run start -- latency --windowMin 60 --mode candidate_intent_position`
- Show attribution leaderboard:
  - `npm run start -- leaderboard --limit 10`
- Build:
  - `npm run build`
- Run compiled CLI:
  - `npm run start -- paper`

You can also override config ad hoc on `run`, `paper`, and `analyze`:
- `npm run paper -- --config config/low-bankroll.json`
- `npm run paper -- --config config/tiny-bankroll.json`
- `npm run paper -- --config config/live-5.json`
- `npm run paper -- --config config/live-40.json`
- `npm run paper -- --config config/scam-scalp.json`
- `npm run start -- run --config config/low-bankroll.json --dashboard`
- `npm run start -- run --config config/tiny-bankroll.json --dashboard`
- `npm run start -- run --config config/live-5.json --dashboard`
- `npm run start -- run --config config/live-40.json --dashboard`
- `npm run start -- run --config config/scam-scalp.json --dashboard`

## Tiny Bankroll Profile ($10-$15)
Use `config/tiny-bankroll.json` when wallet size is around `$10-$15`:
- position notional capped at `$3.5`
- daily loss capped at `$1.5`
- higher reserve (`0.025 SOL`) and stricter slippage/entry gates
- tighter liquidity/holder concentration filters

Suggested start:
- `npm run paper:tiny -- --durationSec 1800`
- review with `npm run stats`

## Micro Live Profile ($5 Wallet)
Use `config/live-5.json` for minimal-notional live testing:
- single open position, max entry notional `$1.25`
- daily realized-loss cap `$0.8`
- hard live-cap `$2` and reserve `0.01 SOL` for fees/exit headroom
- stricter liquidity/volume/holder and trade-score gates than default

Suggested start:
- `npm run paper:5 -- --durationSec 1800`
- then `npm run run:5 -- --durationSec 180 --dashboard` only when live flags are intentionally enabled

## `$40` Profile (No Hard Cap)
Use `config/live-40.json` when you want a tighter bankroll profile without hard capping deployed capital:
- single open position, `$12` max notional per entry
- daily loss cap `$5`, reserve `0.05 SOL`
- tighter entry/exit slippage and conservative 429 sell breaker defaults

Suggested start:
- `npm run paper:40 -- --durationSec 1800`
- then `npm run run:40 -- --durationSec 300` only when live flags are intentionally enabled

## Scam-Scalp Profile (Ultra Guard-Rail, `$25` Core)
Use `config/scam-scalp.json` for a conservative short-hold scalping posture in low-trust markets:
- single open position, small notional (`$6.5`) and daily loss cap (`$3`)
- tighter concentration/liquidity/volume filters and stricter sniper scale gate
- faster guardian checks and stronger sell-429 cooldown behavior
- `maxLiveCapitalUsd=0` is intentional (no hard cap; live capital ceiling remains disabled)

Suggested start:
- `npm run paper:scalp -- --durationSec 1800`
- then `npm run run:scalp -- --durationSec 300 --dashboard` only when live flags are intentionally enabled

## Growth Profile (Higher Upside Capture)
Use `config/growth.json` when you want more upside capture while keeping core guard rails:
- allows up to 2 open positions with larger notional (`$9.5`)
- slightly looser entry/liquidity thresholds and wider profit window
- still keeps Stage-B scale gate, live probe requirement, and fail-closed exits

Suggested start:
- `npm run paper:growth -- --durationSec 1800`
- then `npm run run:growth -- --durationSec 300 --dashboard` only when live flags are intentionally enabled

## Dashboard Sample (TTY)
```
================================================================================
Oclay PAPER Dashboard | uptime 1m42s | refresh 2s | 00:31:07
DB: data/oclay.sqlite
--------------------------------------------------------------------------------
Overview
tokens:                 40
...
--------------------------------------------------------------------------------
Capital
Stream Health
Sell 429 Breaker
Alerts (Critical)
Focused Coin
Recent Risk Reports
Recent Executions (includes router path)
Mint Rollups
...
================================================================================
```

Dashboard CLI flags (run + paper):
- `--hide-success`
- `--only-failures` (takes precedence over `--hide-success`)
- `--focusMint <mint>`
- `--alertsWindowMin <n>`
- `--rollupWindowMin <n>`

## Live Trading (Explicit Opt-In)
Live trading requires **all** of:
- `LIVE_TRADING=true`
- `LIVE_TRADING_CONFIRM=I_UNDERSTAND_THIS_CAN_LOSE_MONEY`
- `WALLET_KEYPAIR_PATH` points to a funded Solana keypair JSON

Then:
- `npm run dev` (or `npm run start -- run`)

## Kill Switch
Set `KILL_SWITCH=true` to disable **new entries** (buys). The bot will still monitor and can still exit existing positions.

## Dashboard Logging
When running with `--dashboard`, logs are routed separately so warnings/errors remain visible:
- `DASHBOARD_LOG_LEVEL` (default `warn`)
- `DASHBOARD_LOG_TARGET` (`stdout`, `stderr`, or `file`; default `stderr`)
- `DASHBOARD_LOG_PATH` (used only when target is `file`)

## Notes / Safety
- This software can lose money quickly. Start in paper mode.
- Paper mode defaults to a conservative fill model (haircuts + network fee estimates), so paper PnL is intentionally less optimistic.
- Live mode includes a conservative SELL-side 429 breaker to avoid rapid retry storms during Jupiter throttling.
- `maxLiveCapitalUsd` is enforced only in live mode and blocks new entries when projected deployed exposure exceeds the cap.
- New tokens are adversarial. Always assume data sources can be wrong or delayed.
- Direct Raydium entry path is currently safety-gated; the router falls back to Jupiter when direct path is unavailable.
- Stream parser uses hybrid strict mode by default (`instruction` path first, heuristic fallback with confidence threshold).
- Sniper scale is fail-closed by default until Stage-B completes clean (`requireStageBForScale=true`).
- Raydium direct BUY path is CPMM-only and feature-flagged off by default (`execution.router.raydium.directEntryEnabled=false`).
- Keep the trading wallet limited to what you're willing to lose.

## Docs
- `docs/architecture.md`
