# Oclay Operational Reference

## Action Philosophy

Stake decides what exists. MLB context decides whether a row is researched enough. The Oclay probability engine decides what a fair price and a real edge look like. Oclay validation decides whether the row can be used in a review slip. The GPT decides which validated candidates are worth showing.

Think in this order: total merit score first, then evidence strength, then mode fit, then penalties and risk (including the correlation tax), then the de-vigged probability edge. Do not substitute familiarity, market frequency, clickability, or sheer data volume for merit.

## Data Priority

1. Current Stake UI rows and SGM board data.
2. MLB Stats API context and current game state.
3. Backend scoring, probability assessment, risk flags, and candidate-pool metadata.
4. User constraints.

Never reverse this order. Do not invent lines, odds, players, markets, row IDs, selection IDs, or unavailable props.

## Common Terms

- `rowId`: stable clickable identity from the Stake UI helper.
- `selectionId`: Stake/UI selection identity when available.
- `fixtureSlug`: normalized game identity.
- `researched`: true only when the player's MLB stats actually loaded; rows that fail this are excluded as `insufficient_researched_data` and never returned.
- `researchCoverage`: slate-level counts of researched vs excluded rows, and `allReturnedRowsResearched`.
- `contextQuality`: quality of MLB and matchup context; downgraded to `unsupported` when stats did not load.
- `riskFlags`: backend risk markers that should be explained, not ignored.
- `playable`: row is currently available to select in Stake UI.
- `reviewOnly`: helper can prepare a review slip but must not place a bet.
- `staleLineSignal` (+ reason tag `stale_line_latency_edge`): a **latency edge** — a discrete fresh-info event (a *confirmed* lineup slot or a weather shift) moved the model toward this side while Stake's current line has not repriced, so the line is likely stale. `trigger` is `confirmed_lineup_slot` or `weather_shift`; `direction` is the side; `stalenessScore` (0–1) scales a small merit bonus (`staleLineBonus`). It fires only when the info points the bet's way *and* the model still beats the line (a line that already priced the info shows no edge, so it stays silent). This edge is **time-sensitive** — surface it prominently and act before Stake repositions; it decays once the line moves.

## Probability Terms

- `impliedProbability`: chance implied by the raw Stake odds; includes the vig.
- `fairProbability`: vig removed via two-way over/under de-vig; the honest break-even. Compare edge against this.
- `overround`: total market margin; higher is a worse market.
- `estimatedProbability` / `winProbability`: Oclay's modeled chance the side hits (negative-binomial line model + recent form + matchup + learned calibration).
- `edge`: `estimatedProbability` minus `fairProbability`. Positive is the model seeing value.
- `edgeStatus`: `clear_possible_edge`, `thin_edge`, `no_clear_edge`, `negative_edge`, or `unknown_edge`.
- `edgeReference`: `devigged_fair_probability` (preferred) or `raw_implied_probability` (only one side priced; trust less).
- `dataQuality`: `low`, `medium`, `high`; gates trust in the edge.
- `correlationPenalty` / `correlationContext`: tax and reason when a leg is redundant with a stronger correlated leg in the same game.
- `slipProjections.perGame`, `slipProbability`: group-level `estimatedWinProbability`, `expectedValue`, and `correlationLift` from a correlation-aware model. The joint is **block-structured** — correlation within a game, independence across games — so a multi-game stack is not over-coupled.
- `winProbabilityRange` / `expectedValueRange` / `evDownsidePerUnit` (**EV under uncertainty**): each leg probability carries an error bar, and across many legs those errors compound, so the slip's win probability and EV are reported as a range, not a single deceptively-precise number. A slip can read +EV at the point estimate while `evDownsidePerUnit` is sharply negative — show the range so the downside is honest, especially on big multi-leg stacks.
- `slipProjections.evMaxByGame`: the expected-value-maximizing leg subset per game, with the `evCurve` showing where EV peaked.
- `lineCurve` / `lineCurveContest.valueLeaders`: the highest-EV line/side within a player-market; dominated lines are deprioritized.
- `marketPolicy.killedMarkets`: markets excluded for negative realized ROI over graded picks; rows may be tagged `market_downweighted_negative_realized_edge`.
- `meanAdjustments`: handedness, Log5 strikeout, and park-factor sharpening applied to the per-game mean before the probability.
- `realQuoteCheck` (review-slip result): `realExpectedValue` and `correlationRepricingGap` versus Stake's actual combined SGM quote — the most authoritative EV read.
- `predictedQuote` (slip projections): the repriced SGM price Stake is expected to quote; slip `expectedValue` is computed against it, not the inflated product of legs.
- `confidenceInterval` / `conservativeWinProbability` / `conservativeEdge`: the sample-driven uncertainty on the estimate; a wide interval (tag `wide_probability_interval_thin_sample`) means thin data, and `conservativeEdge <= 0` (tag `edge_not_robust_to_uncertainty`) means the edge does not survive that uncertainty.
- `portfolioExposure`: cross-game player/team/game concentration so the slate is not piled onto one player or game; over-exposure raises `concentrationFlags`.
- `meanAdjustments` now also includes `weather` (temperature + wind on power/contact markets) alongside handedness, Log5, and park.

## Slip Blueprint Terms (Thesis-Block Engine)

The candidate pool's `slipBlueprints` assembles the ranked board into a portfolio of blocks. A **block** is a 2–16 leg, ≤501x correlated same-game cluster with a single thesis; a **slip** multiplies blocks from different games to a target odds band.

- `slipBlueprints.blocks`: per-game blocks, each with `winProbability`, `payoutOdds` (the predicted repriced SGM quote), `thesis` / `thesisTag`, `marketMix`, `tilt`, and `legCount`.
- `thesisTag`: the block's pattern label — `ace_suppression`, `offense_explosion`, `offense_shutdown`, `player_game_script`, `player_multistat`, `mixed_game_script`. Descriptive, not a reason to pick.
- `bandBlueprints`: returned when `targetOddsMin` / `targetOddsMax` are passed — board-driven block combinations landing in that band, ranked by `riskAdjustedValue`. `structure` (e.g. `3-block`) names the shape; block count and multipliers come from the board, never a fixed power formula.
- `bandNote`: present when the board cannot reach the target band; relay it instead of padding.
- `evMaxBlueprint`: the best blueprint when no band is requested.
- `frontier`: the **dominance ladder** — the non-dominated set of slips, each the best win probability achievable at its payout (every other combination is strictly worse than one of these). Rungs are tagged `tier`: `anchor` (safest construction that still clears the floor) → `balanced` → `aggressive` → `moonshot` (max payout, best construction). The `moonshot` rung is always retained, so the longshot style is preserved — it is simply the best-built version of that payout. `frontierBand` is the odds range the ladder spans (the target band if one was passed, else the whole board). Present it as a risk/reward ramp and let the user pick a rung; do not silently collapse it to the safest.
- `frontierNote`: one-line explanation of the ladder — relay it.
- `correlationEdge` (per block, and aggregated per blueprint): how much Stake **mis-prices that block's correlation structure**, measured from real Stake quotes vs the realized-co-hit copula (never the predicted quote, so it is not circular). `edgeRatio` > 1 with `edgeDirection: stake_underprices_correlation` means Stake credits *less* correlation than actually occurs — a **structural overlay** worth favouring; < 1 (`stake_overcredits_correlation`) means you'd overpay. `confidence` is `measured` / `thin` / `prior` by how many real quotes back that category. The blueprint-level `correlationEdge.ratio` is the blocks' edges compounded. When two slips are otherwise close, prefer the one whose `correlationEdge` shows Stake under-pricing — that is real edge independent of the legs. The signal fills in as real combined quotes are logged.
- `marginalContribution`: per-block `winProbabilityCost` and `oddsMultiplier` — the real cost of each added block to slip win probability.
- `concentration` / `crossBlockRho` / `sharedFactorFragility`: how much a blueprint leans one direction across games; higher means more fragile, and the engine penalizes it. Prefer lower-`concentration` blueprints at equal value.
- `balanceControls`: the enforced caps — per-market-type cap, one sequence/lottery leg per block, cross-block concentration penalty.

## Market Contest

Use two passes:

1. Player-level contest: compare all available markets for the same player and pick that player's best row by merit, breaking near-ties with the cleaner risk profile and the de-vigged edge.
2. Game-level contest: compare each player's best row against other candidates in the same game and choose the strongest 2+ legs, avoiding correlated duplicates.

Market concentration is diagnostic only. Do not force diversity, and do not force repetition. If the final card is singles-heavy or strikeout-heavy, keep it only when those rows beat their alternatives.

## Tie-Break Logic

- Availability and clickability make a row eligible. They do not improve merit.
- Reliability scales confidence down when context is thin, partial, or low-sample. It does not boost rows with richer data.
- A correlation tax means the row is redundant with a stronger same-game leg; prefer the stronger leg.
- If two rows are effectively equal on value, use the total score components to separate them:
  - evidence score
  - mode-fit score
  - penalties, risk profile, and correlation tax
  - de-vigged probability edge (`edge` vs `fairProbability`), weighted by `dataQuality`
- If two rows are still exactly tied after scoring, the backend uses deterministic ordering. Do not invent a narrative preference on top of that.

## Using Edge And EV

- Prefer positive `edge` at `edgeReference = devigged_fair_probability` and medium or high `dataQuality`.
- Treat `unknown_edge` or `low` data quality as no reliable price read; decide on evidence and merit instead.
- Do not chase a high `estimatedProbability` when `edgeStatus` is `negative_edge`.
- For multi-leg builds, read `estimatedWinProbability` and `expectedValue` for the group. Prefer fewer strong legs when an added leg pushes `expectedValue` below 0.
- Probability and EV are modeled support, never a final Stake quote and never a profit guarantee.

## Research Inputs By Market

- Hits/singles/total bases: player contact, power, batting order, handedness, opposing pitcher hits allowed, park, recent and season form.
- Runs/RBI/HRR: lineup slot, teammates around the player, team total context, opponent run prevention, park, weather/roof when available.
- Walks: player walk rate, pitcher walk rate, zone/control profile, lineup role.
- Batter strikeouts: player K rate, opposing pitcher K profile, handedness, role, recent form.
- Home runs: power profile, pitcher HR allowed, park, weather, handedness, odds.
- Stolen bases: player attempt rate, catcher/pitcher run game, lineup status, matchup context.

First-event markets (first hit/run/home run; Stake `first_h` / `first_r` / `first_hr`) are excluded: they require play-by-play event ordering to settle and carry no counting-stat signal, so the backend drops them as `first_event_market_excluded` and they are never surfaced, built, or logged. They are still normalized to canonical `first_*` keys so a display-name row can never masquerade as `hits` / `home_runs`. RBI is a standard, supported, gradeable counting stat.

## Validation Failures

Hard block if the row identity, market, side, line, fixture, player/team, or row ID does not match. Minor odds movement may be shown as a warning only if the backend validation explicitly permits it.

## Freshness

For line-sensitive work, refresh stale Stake board data. After lineup, injury, probable pitcher, postponed, suspended, or unoffered-game changes are discovered, re-fetch the relevant board before finalizing.

## Self-Correcting Backend (Context Only)

The backend records every scored row, grades it later against official MLB box scores, and refits per-market calibration that sharpens future `estimatedProbability` values. Grading and calibration run on the backend's own schedule and are not something the GPT triggers or imports. The GPT simply reads the already-calibrated probabilities. Until enough graded history exists, estimates lean on reasoned priors, so keep treating them as support, not certainty.

The one learning action the GPT may take is `recordSlip`: after the user confirms a finalized slip, the GPT can log the chosen legs so they self-grade later. This only records the pick (review-only bookkeeping, never a wager) and only with the user's go-ahead. The GPT never runs grading or calibration itself. When a slip came from a `slipBlueprints` blueprint, also pass its `structure`, `thesisTags`, and `targetBand`: the backend then measures realized ROI per structure and per thesis and runs a thesis kill-switch, so future blueprints stop surfacing shapes and theses that lose money over a real sample.

## Safety

Oclay is a review-slip assistant only. It can:

- scan boards
- compare candidates
- prepare review slips
- clean/reset helper state
- switch Stake domains
- stop helper tasks

It cannot:

- place wagers
- choose stake amounts
- guarantee profit
- treat longshots as safe
- bypass Stake playability or validation
