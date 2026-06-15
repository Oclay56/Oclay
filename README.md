# OCLAY

Oclay is an AI-led MLB review-slip system for the crypto casino Stake. It reads the live Stake same-game-multi board, enriches every available row with real MLB Stats API context, scores each candidate leg on a genuine probability model, and hands a ranked, row-ID-validated, review-only candidate pool to a Custom GPT that assembles slips for a human to approve.

What makes this build different from a static heuristic: **OCLAY measures whether its own picks are right and corrects itself.** Every scored row is recorded, graded against the next morning's box score, and fed back into per-market calibration. The scoring constants are no longer guesses — they become measurable and self-tuning.

## The closed learning loop

```
candidate pool  ──▶  pick ledger  ──▶  grading  ──▶  calibration  ──▶  probability engine
   (scores)          (records)        (settles vs       (Brier +          (applies fitted
                                       box scores)       Platt fit)         corrections)
        ▲                                                                          │
        └──────────────────────── better-calibrated next pick ◀────────────────────┘
```

- **Probability engine** ([app/probability_engine.py](app/probability_engine.py)) — replaces the old proxy blend with a negative-binomial survival function over the player's season per-game rate (Poisson is the low-dispersion limit), empirical-Bayes shrinkage toward that prior using the recent line-clearing rate, a bounded logit matchup shift, and learned per-market calibration. Edges are measured against **de-vigged** fair odds (two-way over/under normalization), not the raw price.
- **Pick ledger** ([app/pick_ledger.py](app/pick_ledger.py)) — SQLite store of every scored row and built slip, keyed per slate so the full pool is graded (no selection bias). Records each leg's opening odds and model probability for later grading. A pending leg whose player provably had no game on the slate date (DNP / scratch) is auto-voided so it leaves the pending list and stays out of calibration.
- **Grading** ([app/grading.py](app/grading.py)) — settles pending picks win/loss/push against the real MLB game log, then settles slips from their legs.
- **Calibration** ([app/calibration.py](app/calibration.py)) — Brier score, log loss, reliability buckets, and a regularized Platt correction per market, written back for the probability engine to apply (weighted by graded sample size).
- **Correlation + slip EV** ([app/correlation.py](app/correlation.py)) — a single-factor Gaussian copula turns calibrated leg probabilities into a true joint slip win probability and expected value. The joint is **block-structured** (correlation within a game, independence across games), so a multi-game stack is not over-coupled. It also reports an **EV-under-uncertainty range** (`expectedValueRange`, `winProbabilityRange`): each leg probability carries an error bar, and across many legs those errors compound, so a slip that looks +EV at the point estimate reveals its real downside.

### Edge-finding layers

On top of the learning loop, these hunt and verify mispricing:

- **Matchup-sharpened means** ([app/matchup_model.py](app/matchup_model.py)) — the per-game mean feeding the distribution is adjusted for handedness platoon splits, Log5 batter/pitcher strikeout interaction, venue park factors, weather, and a **lineup-spot plate-appearance factor** (today's confirmed batting slot scales the expected volume for PA-driven markets) before the probability is computed.
- **Thesis-block slip engine + dominance frontier** ([app/thesis_blocks.py](app/thesis_blocks.py)) — slips are assembled as portfolios of ≤501x correlated same-game blocks multiplied across games to a target band via a beam-search decomposition (never a fixed `50^x` formula). The assembler then returns a **Pareto-frontier ladder**: out of billions of possible combinations it keeps only the non-dominated slips (each the best win probability achievable at its payout), labeled `anchor → balanced → aggressive → moonshot`. The moonshot rung is always retained, so a longshot stays a longshot — just built optimally.
- **Correlation-mispricing detector** ([app/quote_model.py](app/quote_model.py)) — the realized co-hit copula's correlation multiplier over the one Stake's *real* combined quote implies (`realizedScalar`), measured **per correlation category**. A category whose scalar runs above 1 is one Stake under-prices — a structural overlay. It reads only the real Stake quote (never the predicted quote), so it is not circular; every block carries a `correlationEdge`.
- **Stale-line / latency edge** ([app/stale_line.py](app/stale_line.py)) — when a discrete fresh-info event (a *confirmed* lineup slot, a weather shift) moved the model toward a side while Stake's current line still shows a model edge, the line likely hasn't repriced. That gap is a latency edge — value from being faster, not smarter — and it earns a small, capped merit bonus. It fires only when the info points the bet's way *and* the model still beats the line, so an already-priced line stays silent.
- **Sharp-line value / line-shopping** ([app/sharp_lines.py](app/sharp_lines.py)) — the most reliable edge in betting: the market's **no-vig** price is the best estimate of the true probability, so each Stake candidate is compared to the matching market line — the two-way price is devigged and `edge = sharpFairProbability − stakeImpliedProbability`. When Stake's price beats the consensus it is a real overlay (largest capped merit bonus); when it is worse, the row is flagged. It is a real-time comparison (no waiting for a close) and degrades to no-signal when no line data is loaded.
- **The Odds API feed** ([app/odds_api.py](app/odds_api.py)) — fills the sharp-lines snapshot from [the-odds-api.com](https://the-odds-api.com): lists the slate (free), pulls each game's player props, and reshapes them into the line-shopping table. Pinnacle does not carry MLB player props there, so the default reference is a **multi-book no-vig consensus** (median across the US books that price each prop) — Stake landing well off the consensus is the edge; set `OCLAY_ODDS_API_BOOKMAKER` to a single book to use just that one. Refresh via `python -m app.learning_cli sharp-refresh` or `POST /oclay/sharp-lines/refresh`. Requests are billed per market per game, so the market list is kept lean and `--max-events` caps usage.
- **Alt-line curve contest** ([app/sgm_candidate_pool.py](app/sgm_candidate_pool.py)) — every available line/side on a player-market is priced; the highest-EV point is the value leader and inferior lines on the same player-market are deprioritized. Books are rarely wrong about a player, only about a specific line.
- **Real Stake quote check** ([app/real_quote.py](app/real_quote.py)) — when the review slip is built, the actual combined SGM odds are read from the live sidebar and EV is recomputed against the real payout, exposing the correlation repricing gap versus the naive product of legs.
- **EV-max build mode** ([app/slip_optimizer.py](app/slip_optimizer.py)) — adds legs only while correlation-aware slip EV increases, stopping at the peak, so fewer strong legs beat more weak ones by construction.
- **Market kill-switch** ([app/calibration.py](app/calibration.py)) — markets whose model edge has not paid off over enough graded picks (negative realized ROI) are excluded or downweighted. Stop playing the games you lose.
- **Measured correlations** ([app/correlation_calibration.py](app/correlation_calibration.py)) — the copula's correlation priors are replaced by the realized co-hit rate (phi) per category as graded pairs accumulate, weighted by sample size.
- **Timing windows** ([app/timing.py](app/timing.py)) — flags which games are in the lineup-confirmation window (2-4 hours out, when lineups post and lines move) so a scheduler can rescan the board at the right moment and feed the stale-line / latency detector.

### Running the loop

The API exposes operational endpoints (not part of the curated GPT schema):

| Endpoint | Purpose |
| --- | --- |
| `POST /oclay/learning/grade` | Settle pending picks against MLB box scores |
| `POST /oclay/learning/calibrate` | Refit per-market calibration and refresh the cache |
| `GET /oclay/learning/calibration-report` | Brier / buckets / corrections / correlation mispricing, read-only |
| `GET /oclay/learning/summary` | Graded hit rate and pick volume |
| `POST /oclay/timing/plan` | Games in the lineup-confirmation rescan window |
| `POST /oclay/sharp-lines` | Ingest a sharp-book line snapshot for line-shopping |
| `POST /oclay/sharp-lines/refresh` | Pull fresh lines from The Odds API (`maxEvents` caps credits) |
| `GET /oclay/sharp-lines/status` | How many sharp lines are loaded |

Or run the nightly job directly (schedule once a day after slates finish):

```bash
python -m app.learning_cli loop --date 2026-05-08   # grade, then calibrate
python -m app.learning_cli summary
```

Set `OCLAY_LEDGER_PATH` to control the SQLite location; `OCLAY_DISABLE_CALIBRATION=1` reverts the probability engine to raw model output.

## Local TUI

Launch the same PowerShell/Textual style interface used by Stake-GPT:

```bat
Oclay.bat
```

The TUI exposes only:

- Review
- Build
- Clean
- Domain
- Stop
- Exit

## API Schema

The API runs locally; expose it to the Custom GPT through a tunnel (cloudflared
or an ngrok static domain) and import this schema into the action:

```text
https://<your-tunnel-domain>/gpt/openapi.json
```

## Guardrails

- Review-only. Never place bets or enter stake amounts.
- Every SGM group requires at least 2 legs.
- A single game group may not exceed 16 legs.
- SGM group odds may not exceed 501x decimal odds.
- Use current Stake UI rows first; never invent unavailable markets, lines, odds, row IDs, or selection IDs.
- Compare all available player markets on merit before selecting a row.
- Estimated probabilities and expected values are modeled support data, not a final Stake SGM quote; the Custom GPT owns the final selection.

## Fully local — no external services

OCLAY runs entirely on your machine. There is no Render deploy and no Supabase
project; the only outbound calls are to Stake and the free MLB Stats API.

- **API ↔ helper bridge** — the FastAPI API and the Stake Chrome helper rendezvous through a local WAL-mode SQLite queue (`data/local_ui_jobs.sqlite`, [app/local_ui_bridge.py](app/local_ui_bridge.py)). Finished job rows are auto-pruned, so it stays tiny.
- **Learning history** — the pick ledger is local SQLite (`OCLAY_LEDGER_PATH`, defaults under `data/`). Market mappings are stored locally too.
- **Reaching the GPT** — a tunnel (cloudflared / ngrok static domain) forwards the Custom GPT to the local API; repointing the action URL is the whole setup.
- **Storage** — everything is SQLite + rebuildable Chrome caches. `python -m app.local_cleanup` (or `local_cleanup.bat`) prunes the job queue and Chrome caches; the helper also runs it on `OCLAY_AUTO_CLEANUP_MINUTES`.
