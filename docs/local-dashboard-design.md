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

## 4. Avoiding hits-reliance — by measuring value, not by penalizing hits

The stance is "the opposite of an LLM's instinct," but the *mechanism* is the
subtle part. An LLM over-picks `hits` because it confuses **likely** with
**good**: hits has the highest raw hit-rate, so anything that rewards likelihood
gravitates there. But hits is the most heavily bet, most efficiently priced
market, so its de-vigged fair price already reflects that probability — the actual
**edge is near zero.**

So the engine adds **no diversity dial and no counterweight against hits.** A knob
that demotes hits would fight merit and bury a *genuinely good* hits bet — exactly
what we will not do. Instead, variety is an **emergent consequence of ranking on
edge (value vs the real market), not on likelihood**:

- A hits bet the model thinks is **genuinely mispriced** → real edge → it gets
  played. Authentic, merit intact.
- A hits bet that is merely "safe and likely" but fairly priced → ~0 edge → it
  falls on its own, with no override.

The system avoids the boring chalk *for the right reason* — there is no value there
— not because a setting told it to. If a night's genuine edges happen to cluster in
one market, that is signal and we play them; we only kill **forced** repetition of
**safe** props, which edge-first ranking eliminates by itself.

**Three merit-preserving mechanisms (no dial, no override):**
- **Rank on edge, not probability** (`edge = estimatedProbability − fairProbability`,
  already in the model). This is the entire engine of natural variety.
- **The realized-ROI kill-switch** prunes markets by **data, not taste** — a hits
  bet that pays survives; one that chronically loses gets downweighted.
- **The correlation/concentration penalty, framed as *risk*** — six correlated
  legs are not six independent shots, so an all-one-stat slip is genuinely more
  fragile. It only bites when legs truly move together; independently-strong legs
  across different players are never touched.

**Repetition/novelty is display-only or a pure tiebreaker** — the TUI flags "bet
this player yesterday" as info and uses freshness only to break a genuine tie
between equally-meritorious bets. It never demotes a still-good bet.

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
3. **Merit-honest variety** — keep ranking on edge (not likelihood); frame the
   concentration penalty as risk. **No diversity dial or override** (see §4).
4. **Novelty surfacing** — read recent players/props from the ledger and *flag*
   repeats (display + tiebreaker only, never a merit demotion).
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

## 12. Decisions

**Locked:**
- Dashboard form: **TUI** — extend the existing Textual `Oclay.bat` with a
  decision/bands screen. CLI stays only as an optional scriptable companion.
- Anti-hits: **no diversity dial, no override.** Variety is emergent from
  edge-first ranking; novelty is display/tiebreaker only (§4).

**Still open (settle before Phase 1):**
1. **GPT fate** — demote to optional (recommended) vs. fully remove.
2. **Default scan scope** — all games vs. a chosen subset (rate-limit trade-off).
3. **Band tiers** — fixed magnitudes (10x / 100x / 1k / 10k / 100k / max) vs.
   adaptive to what the board actually reaches that night.
4. **TUI ↔ engine wiring** — TUI calls the local API over localhost (same path the
   GPT used) vs. imports the engine + job store in-process.
5. **Execution-ready gating** — a band is "buildable" only if its legs have
   confirmed UI rowIds (not feed props); confirm the menu builds from the UI
   candidate pool and flags non-executable constructions.
6. **`Failed to fetch` second-line recovery** — add page-reload + Cloudflare
   re-clear before re-read now, or wait and see if the retry/backoff suffices.
