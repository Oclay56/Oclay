# OCLAY Local Decision Dashboard — Design

Status: **proposal / not yet built.** This captures the agreed direction so it can
be reacted to as one picture before any code is written.

## 1. The vision in one line

Stop pushing intent *into* a remote AI. Let the **local engine read the whole
board and propose a menu of the sharpest plausible slips at every payout
magnitude**, and the user just **picks one and confirms**. The engine computes;
you decide.

## 2. The core inversion

Today the Custom GPT is the driver: you describe what you want in English, it
orchestrates the API calls, selects legs, and narrates. That puts **OpenAI's
servers in the critical path** — latency, timeouts, the model skipping pipeline
steps or leaning on familiar props.

The realization that makes this worth doing: **the intelligence is already local
Python.** The scoring, ranking, market/line/game contests, the dominance
**frontier ladder**, correlation/EV, the edge signals, and the learning loop all
run on this machine. The GPT is a thin — and partly redundant — orchestration +
selection + natural-language layer on top of a brain we already own.

So this is **not removing the model.** It is replacing a slow, unreliable remote
front-end with a fast, deterministic local one. "Engine proposes, you dispose."

## 3. User-facing model

1. **Launch → scan the slate.** The dashboard reads the board (all games, or a
   chosen subset) and computes the full ladder.
2. **A menu of payout bands appears** — e.g. `~15x`, `~250x`, `~5kx`, `~50kx`,
   `max reachable`. Each band is the *sharpest construction the board supports at
   that magnitude*, not padded junk to hit a round number. The **shape is
   discovered** (e.g. `50^3`, `2 legs across 15 games`, `four single-game
   blocks`) from what the board actually offers — never a fixed formula.
3. **Each band card shows:** payout, win probability, EV (with the
   uncertainty range), the legs, a one-line "why" (the edges behind it), and an
   **exposure meter** (how it splits across market / player / game).
4. **Type-a-target box** as the custom order: type `10k` and the engine
   constructs the best slip(s) to reach ~10,000x from whatever games qualify.
   (The preset bands are the menu; the box is the à-la-carte order.)
5. **Click a band → build.** This fires the existing validate → click-into-Stake →
   real-quote-check → auto-log flow. No retyping, no OpenAI.
6. **Re-roll / tweak** before committing: ask for a *different* construction at
   the same magnitude, swap a leg, or slide the diversity dial.

## 4. Anti-hits / anti-repetition as a first-class principle

The defining product stance: **the opposite of an LLM's instinct.** An LLM leans
on `hits` and repeats familiar props because it pattern-matches to what's frequent
— not because it's optimal.

**Why leaning on hits is also bad EV (not just bad taste):** the popular,
"consistent" props are the most heavily bet and the most sharply priced by books,
so they hold the *least* edge. The mispricing — the actual money — lives in the
**thinner, less-trafficked markets** that books pay less attention to. This is the
same reason the sharp-line signal finds more overlays in thin markets. So "don't
rely on hits" is a real optimization principle, and a deterministic engine that
hunts edge + variety is the opposite of the GPT **by construction**.

**The hard guardrail:** diversity is a **search bias and a tiebreaker, gated by
merit** — explore the less-obvious props, and when two constructions are close,
prefer the more varied / less hits-reliant one; but **never play a worse leg just
to be different.** Dynamic, not dumb.

Mechanisms (some exist, some new — see §6):
- **Variety as an objective**, not only a penalty (extend the existing
  diversity-adjusted marginal selection + concentration penalty).
- **Market-efficiency weighting** — bias toward thinner markets where overlays
  live, which naturally steers away from hits.
- **Novelty memory** — the local ledger remembers recently shown/built players
  and props, so night-to-night the menu does not re-serve the same names.
- **Exposure meter + diversity dial + re-roll + contrarian mode** — see the
  concentration, choose how spread you want it, regenerate alternatives.

## 5. Architecture & data flow

```
        ┌──────────────── all local, no cloud ────────────────┐
Browser │ Dashboard UI  ──HTTP(localhost)──►  FastAPI (app.main) │
(you)   │  - band menu                          │               │
        │  - type-a-target box                  ▼               │
        │  - exposure / re-roll      candidate pool + frontier  │
        │                            (sgm_candidate_pool,       │
        │                             thesis_blocks)            │
        │                                       │               │
        │                                       ▼               │
        │   click "Build" ──►  validate ──► local job queue ──► Stake helper
        │                      (validate-     (local_ui_bridge)   (Chrome)
        │                       selections)         │               │
        │                                           ▼               │
        │                              real-quote check + auto-log (pick_ledger)
        └──────────────────────────────────────────────────────────┘
```

No OpenAI anywhere. The dashboard talks to the same local API the GPT used; the
"selection" the GPT did is replaced by surfacing the engine's own ranked
construction and letting the user pick.

## 6. What already exists vs. what's new

### Already built (the brain — reuse as-is)
- **Candidate pool + per-prop context, scoring, contests** — `build_sgm_candidate_pool_from_boards` ([app/sgm_candidate_pool.py](../app/sgm_candidate_pool.py)).
- **The band/ladder engine** — `assemble_frontier`, `pareto_frontier`, `_select_ladder`, `_label_tiers` (anchor→balanced→aggressive→moonshot), `build_slip_blueprints`, board-driven `bandBlueprints` ([app/thesis_blocks.py](../app/thesis_blocks.py)). **This is the band menu.**
- **Diversity foundations** — diversity-adjusted marginal leg selection, `marketMix`, per-block market-type cap, cross-block `concentration`/`crossBlockRho` penalty, lottery cap ([app/thesis_blocks.py](../app/thesis_blocks.py)).
- **Anti-hits-via-data** — the realized-ROI market kill-switch already downweights/excludes markets that don't pay (`build_market_policies`, [app/calibration.py](../app/calibration.py)).
- **Edge signals** — sharp-line, stale-line, correlation-mispricing (per row/block).
- **Validate / build / real-quote / log** — `/mlb/validate-selections`, `/mlb/stake-ui/review-slip(+batch)`, `realQuoteCheck`, `recordSlip` — all via the local job queue + helper.
- **Live-trigger inputs** — lineup-confirmation / line-move windows ([app/timing.py](../app/timing.py)).
- **Local job queue + ledger** — `LocalSqliteJobStore`, `PickLedger`.

### New work (mostly the *face* + turning diversity into an objective)
1. **A slate-scan orchestration call** — "read all games → assemble the full
   ladder across magnitudes" (compose existing functions; rate-limit-aware).
2. **The dashboard UI** — band menu, target box, exposure meter, re-roll,
   diversity dial. Served as a local web page by the existing API.
3. **Diversity-as-objective upgrade** — promote variety from a tax to a scored
   objective; add market-efficiency weighting and the diversity dial.
4. **Novelty memory** — read recent players/props from the ledger and
   de-prioritize repeats across sessions.
5. **Click-to-build wiring** — band card → existing validate+build flow.
6. **(Optional) local NL** — a shorthand command bar (regex grammar) and/or a
   small local LLM (Ollama) as a parameter-extractor, so casual input never
   needs OpenAI.

## 7. Dynamic behavior (must never be a dead snapshot)
- **Live re-rank** — as lineups confirm and lines move (timing windows), bands
  recompute and flag "sharper / decayed."
- **Progressive load** — the menu fills in as games are read, instead of blocking
  on a full sweep.
- **Re-roll** — regenerate an alternative non-dominated slip at a band on demand.

## 8. The one real constraint: Stake rate-limiting
A full-slate scan does many board reads → exactly the `Failed to fetch` /
throttling we hardened against. Design for it: reuse the board-read cache, respect
`OCLAY_SGM_BOARD_THROTTLE_SECONDS`, scan incrementally, and let the menu populate
progressively rather than hammering Stake up front. The retry/backoff already in
`_fetch_sgm_board_in_browser` is the floor, not the whole answer.

## 9. The GPT's new role
**Demote, don't necessarily delete.** The dashboard is the primary, reliable
driver; the GPT becomes an *optional* English front-end for rare requests, off the
critical path. OpenAI is never what you wait on day-to-day, but the escape hatch
stays. Local NL (shorthand grammar, later a local model) can replace it entirely
if desired.

## 10. Guardrails / non-goals
- **Merit first.** Variety, novelty, and contrarian bias are tiebreakers/search
  biases, never overrides of edge.
- **Review-only.** The dashboard prepares slips for the user to place; it never
  enters a stake amount or clicks the final wager button — same rule as today.
- **No new cloud dependency.** Everything stays local; any NL parsing runs on
  this machine.
- **Don't over-build the brain.** It exists. The work is presentation + the
  diversity objective + novelty memory.

## 11. Proposed build order (each phase usable on its own)
1. **Slate-scan + band API** — one endpoint: scan (cache/throttle-aware) →
   return the labeled ladder across magnitudes + a per-band exposure summary.
2. **Read-only dashboard** — render the band menu + cards + exposure meter from
   that endpoint. No building yet; just *see* what the engine proposes.
3. **Click-to-build** — wire a band card to validate + build + real-quote + log.
4. **Type-a-target box** — arbitrary target band → same pipeline.
5. **Diversity-as-objective + novelty memory** — the anti-hits/anti-repeat upgrade.
6. **Dynamic layer** — live re-rank, progressive load, re-roll.
7. **(Optional) local NL** — shorthand bar, then a local model if wanted.

## 12. Open decisions (for the user)
- Dashboard form: **local web page** (recommended, most visual) vs. extended TUI
  screen vs. minimal one-button CLI.
- GPT: **demote to optional** (recommended) vs. fully remove.
- Default scan scope: all games vs. a chosen subset (rate-limit trade-off).
- How aggressive the anti-hits bias should be by default (the diversity dial's
  resting position).
