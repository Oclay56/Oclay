# OCLAY Thesis-Block Slip Engine

> Status: implemented. This doc is the canonical reference the engine is built
> against. Code lives in `app/thesis_blocks.py` and is wired through
> `app/sgm_candidate_pool.py`, `app/pick_ledger.py`, `app/backtest.py`,
> `app/calibration.py`, and `app/learning_report.py`.

## 1. Mental model

A slip is a **portfolio of blocks**, not a flat list of legs.

- **Block** — a 2–16 leg, ≤501× cluster *inside one game* (a same-game multi)
  whose legs are positively correlated and share an edge ("ace throws a gem" →
  his strikeouts over + opposing hitters' unders). Correlation is *tight inside
  a block*.
- **Slip** — several blocks across *different* games, deliberately chosen to be
  *low-correlation with each other*, multiplied up to a target odds band.

Tight correlation inside a block, loose correlation across blocks. Each block
wins or loses as a single thesis; the blocks do not all die from one event.

## 2. Dynamic, not a formula

You set the **target band** (e.g. 50k×, expressed as a range like 40k–60k). The
engine reads **what the board actually offers that night** and chooses the block
count and each block's multiplier. The same 50k target yields `75× · 22× · 31×`
one night and five soft `~9×` blocks another — the board sets the shape, never a
fixed `50³`/`10⁵`. If the board cannot support the target cleanly, the engine
returns the best honest slip and says how high it *can* reach, rather than
padding with a junk block.

## 3. Hard guardrails (constants already in the codebase)

- Min **2** legs per game (`GAME_CONTEST_MIN_LEGS`).
- Max **16** legs per game (`DEFAULT_MAX_LEGS_PER_GAME_GROUP`).
- Max **501×** per game for player props (`DEFAULT_MAX_SGM_GROUP_ODDS`).
- Slate caps: 15 normal / 20 hard games; per-player/team/game slip exposure
  caps live in `app/exposure.py`.

Every block lives inside these fences.

## 4. Pipeline

| Stage | Module | Reuse vs New |
|---|---|---|
| 1. Scan board | `sgm_candidate_pool` (unchanged) | reuse |
| 2. Form blocks | `thesis_blocks.build_block` | new — uses `correlation` copula + caps + fixes #1/#2 |
| 3. Rank blocks | `thesis_blocks.rank_blocks` | new — reuses the realized kill-switch |
| 4. Decomposition search | `thesis_blocks.assemble_to_target` | new core — reuses copula + `exposure` + fixes #3/#4 |
| 5. Thesis labeling | `thesis_blocks.label_block` | new — descriptive only |
| 6. Log with structure tags | `pick_ledger.record_slip` | extended |

The math (per-leg calibrated probability, single-factor Gaussian copula, the
predicted Stake quote) is reused from `app/correlation.py` and
`app/quote_model.py`. The engine assembles existing parts plus one new core
(the decomposition search) — it is not a parallel re-implementation.

## 5. The four balance fixes

These address the observation that the scorer naturally over-loads high-data
markets (hits, total bases, strikeouts) and mis-handles rare/lottery props.

1. **Per-market-type diminishing cap** — Stage 2. The Nth leg of a market type
   inside a block pays a growing penalty on its marginal value, and a hard
   per-type cap stops a block becoming one stat family. Replaces the old
   diagnostic-only concentration warning with something that shapes selection.
2. **First-X / sequence risk class** — Stage 2. "First hit / first run / first
   home run" and lottery markets (home runs, stolen bases) are detected by
   pattern and get extra probability shrinkage plus a low per-block cap, because
   their edge estimate is the least trustworthy and their one-player-only
   exclusivity is not captured by the counting-stat model.
3. **Cross-game same-market-same-side correlation tax** — Stage 4. Blocks that
   lean the same direction on the same market family share a hidden common
   factor (hot-bat night, juiced ball). The decomposition prices this by running
   the chosen blocks back through the *same* single-factor copula with an
   effective cross-block correlation that rises with same-direction
   concentration — so the joint probability is honest about shared risk.
4. **Marginal-probability readout** — Stage 4. Each block in a finished slip
   reports what it costs: the joint win probability with and without it, and the
   odds it adds. The compounding ("ten unders hit, the eleventh busts") becomes
   visible instead of hidden behind leg-by-leg safety.

## 6. Feedback loop

- `backtest.py` reports **per-structure** ROI (do 3-block 50k slips beat 5-block
  50k slips?) and **per-thesis** ROI (does "ace gem" actually pay?).
- `calibration.py` extends the kill-switch from per-market to **per-thesis**: a
  thesis whose realized ROI goes negative over a real sample is downweighted or
  retired, using the same mechanism that already kills losing markets. The block
  ranker reads the active thesis policies, so a losing thesis stops being
  surfaced.

Honest dependency: the cross-block copula and per-thesis learning need graded
volume. The engine launches on *structural* correlation (known stat
relationships) and sharpens as real slips settle.

## 6a. First-event markets (first hit / run / home run)

Stake exposes first-event props under the backend keys `first_h`, `first_r`,
`first_hr`. These are **recognized but quarantined** in a separate lane:

- They normalize to canonical keys `first_hit` / `first_run` / `first_home_run`
  ([market_normalization.py](../app/market_normalization.py)). Spelled-out
  display labels ("First Home Run") are aliased too, so they can **never leak
  into `hits` / `home_runs` and be misgraded** as a counting-stat total.
- They are **held out of the researched pick set** and surfaced in the candidate
  pool's `optionalSequenceMarkets` section — available for deliberate, on-thesis
  use, flagged high-variance and `gradeable: false`.
- They are in the sequence/lottery risk class (probability shrink + one per
  block) if ever used in a block.
- Grading **skips** them with the clear reason `sequence_market_pending_grader`
  rather than settling them wrong, so the ROI/calibration loop is never poisoned.

Settling them correctly needs a play-by-play first-event grader (a planned
follow-up). RBI, by contrast, is an ordinary counting stat and is a fully
supported, gradeable, standard pick.

## 7. Surfaces

- The live `/mlb/stake-ui/sgm-candidate-pool` endpoint now returns a
  `slipBlueprints` section: the per-game blocks, the band-targeted blueprints,
  and a default EV-max blueprint. The Custom GPT still owns the final pick.
- `recordSlip` accepts `structure`, `thesisTags`, and `targetBand`, persisted on
  the slip so the feedback loop can learn from them.
- The Profitable report prints structure ROI and thesis ROI tables.
