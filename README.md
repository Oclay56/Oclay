# OCLAY

Oclay is an AI-led MLB review-slip system built on the Stake-GPT core. It reads the live Stake same-game-multi board, enriches every available row with real MLB Stats API context, scores each candidate leg on a genuine probability model, and hands a ranked, row-ID-validated, review-only candidate pool to a Custom GPT that assembles slips for a human to approve.

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
- **Pick ledger** ([app/pick_ledger.py](app/pick_ledger.py)) — SQLite store of every scored row and built slip, keyed per slate so the full pool is graded (no selection bias). Records opening odds and a near-first-pitch closing snapshot for CLV.
- **Grading** ([app/grading.py](app/grading.py)) — settles pending picks win/loss/push against the real MLB game log, then settles slips from their legs.
- **Calibration** ([app/calibration.py](app/calibration.py)) — Brier score, log loss, reliability buckets, and a regularized Platt correction per market, written back for the probability engine to apply (weighted by graded sample size).
- **Correlation + slip EV** ([app/correlation.py](app/correlation.py)) — a single-factor Gaussian copula turns calibrated leg probabilities into a true joint slip win probability and expected value, and finally fills the previously-dead `correlationPenalty` (redundant same-player legs are taxed because Stake reprices SGM correlation through `betFactor`).

### Running the loop

The API exposes operational endpoints (not part of the curated GPT schema):

| Endpoint | Purpose |
| --- | --- |
| `POST /oclay/learning/grade` | Settle pending picks against MLB box scores |
| `POST /oclay/learning/calibrate` | Refit per-market calibration and refresh the cache |
| `GET /oclay/learning/calibration-report` | Brier / buckets / corrections, read-only |
| `GET /oclay/learning/summary` | Graded hit rate, average CLV, pick volume |
| `POST /oclay/learning/closing-snapshot` | Record near-first-pitch odds for CLV |

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

After deployment, import this schema into the Custom GPT action:

```text
https://<your-oclay-render-service>/gpt/openapi.json
```

## Guardrails

- Review-only. Never place bets or enter stake amounts.
- Every SGM group requires at least 2 legs.
- A single game group may not exceed 16 legs.
- SGM group odds may not exceed 501x decimal odds.
- Use current Stake UI rows first; never invent unavailable markets, lines, odds, row IDs, or selection IDs.
- Compare all available player markets on merit before selecting a row.
- Estimated probabilities and expected values are modeled support data, not a final Stake SGM quote; the Custom GPT owns the final selection.

## Supabase

The Oclay schema keeps:

- `market_mappings`
- `local_ui_jobs`

Apply `supabase/gpt_action.sql` to the Oclay Supabase project before using the local helper bridge. The pick ledger is local SQLite by default; point `OCLAY_LEDGER_PATH` at a persistent volume on Render to retain learning history across deploys.
