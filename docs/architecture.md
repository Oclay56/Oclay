# Architecture

## High-Level Data Flow
1. **Discovery** polls DexScreener for new Solana token profiles.
2. For each token, **Analyzer** builds a `TokenRiskReport` (mint safety, Token-2022 extensions, holder concentration, liquidity/volume/age, route feasibility, basic dev heuristics).
3. **Strategy** converts the report into deterministic `TradeIntent`s (BUY/SELL/HOLD) and applies portfolio risk limits.
4. **Execution** (paper or live) carries out the intent and records a `TradeExecutionResult`.
   - Live mode simulates, sends, confirms, and reconciles settled balances from on-chain transaction meta.
   - Paper mode uses conservative fill modeling by default.
5. **Guardian** monitors open positions and triggers emergency exits on critical risk signals.

## Modules
- `src/discovery/*`: token discovery and caching.
- `src/analyzer/*`: produces `TokenRiskReport`.
- `src/strategy/*`: scoring + deterministic decisions.
- `src/execution/*`: paper fills or Jupiter Ultra live swaps.
  - `reconcile.ts`: fail-closed settlement reconciliation.
  - `exitSizing.ts`: wallet-aware live sell amount resolution.
- `src/guardian/*`: continuous monitoring + emergency exits.
- `src/storage/*`: SQLite persistence + audit trail.
- `src/providers/*`: Solana RPC + DexScreener + Jupiter Ultra HTTP clients.

## Safety Rails
- Live trading is gated by `LIVE_TRADING=true` and `LIVE_TRADING_CONFIRM=I_UNDERSTAND_THIS_CAN_LOSE_MONEY`.
- Hard rejects fail closed (no exit route, dangerous authorities/extensions, concentration, low liquidity).
- Global portfolio limits (max open positions, max notional, max daily loss).
- Cooldowns/blocklist after probe failures or repeated execution failures.
