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

## 8. Scanning the full slate safely (batched)
The bands are computed over the **whole slate**, but the scan runs in
**rate-limit-safe batches**: read a group of games the throttle can handle, then
the next group, until every game is read — letting the menu **populate
progressively** as batches land rather than hammering Stake up front. Once the
full board is in, the existing **elimination/scoring** runs (per-prop context →
edge → market/line/game contests → realized-ROI kill-switch), then the frontier
assembles the bands. Reuses the throttled `read_stake_sgm_boards_batch` + the
board-read cache and respects `OCLAY_SGM_BOARD_THROTTLE_SECONDS`. The retry/backoff
in `_fetch_sgm_board_in_browser` is the per-read floor; batching is the
slate-level guard.

## 9. The GPT is removed
The Custom GPT path is **fully removed** — no OpenAI in the loop at all. The TUI is
the only driver. "Tell it what you want" is the local **type-a-target box** (e.g.
`10k`), which is a trivial local magnitude parse, not a remote model. If richer
free-form input is ever wanted it stays **local** (a shorthand grammar, or a small
local model like Ollama) — never a cloud dependency. Removing the GPT also means
the Custom-GPT action schema + instruction files stop being the product surface;
they can be retired once the TUI covers their flows.

## 10. Guardrails / non-goals
- **Merit first.** Variety, novelty, and contrarian bias are tiebreakers/search
  biases, never overrides of edge.
- **Review-only.** The dashboard prepares slips for the user to place; it never
  enters a stake amount or clicks the final wager button — same rule as today.
- **No new cloud dependency.** Everything stays local; any NL parsing runs on
  this machine.
- **Don't over-build the brain.** It exists. The work is presentation + the
  diversity objective + novelty memory.

## 11. Build order (each phase usable on its own)
1. **Slate-scan + band API** — one endpoint: batched, throttle/cache-aware scan
   over the full slate → the adaptive labeled ladder across reachable magnitudes
   + a per-band exposure summary. Read-only.
2. **Start + decision screen (read-only)** — the new `Start` flow renders the live
   scan status + the adaptive band menu. No building yet; just *see* what the
   engine proposes (§14).
3. **Rich slip preview** — per-game cards, structure label, per-leg edge/why,
   slip win-prob + EV range. Still no building (this is "Review").
4. **Build button** — a card's `Build` action → validate → click into the Stake
   slip → real-quote check → auto-log (§14).
5. **Custom target input** — type an arbitrary target band → same pipeline.
6. **Merit-honest variety + novelty surfacing** — edge-first (no dial); novelty
   flagged as display/tiebreaker only (§4).
7. **Dynamic layer** — live re-rank, progressive load, re-roll.
8. **Menu reorg + hotkey remap** — remove Review/Build from the main menu, add
   `Start` (`ctrl+s`), move `Stop` to `ctrl+d` (§15).
9. **Retire the Custom GPT** — remove the action schema + instruction files once
   the TUI covers their flows (§9).

## 12. Decisions — settled

- **Dashboard form: TUI** — a decision/bands screen inside the existing Textual
  app, launched by the single `Oclay.bat` at the repo root (see §13).
- **GPT: fully removed.** No OpenAI anywhere; the local type-a-target box is the
  only "tell it what you want" input (§9).
- **Anti-hits: no dial, no override.** Variety emergent from edge-first ranking;
  novelty display/tiebreaker only (§4).
- **Scan scope: full slate, in rate-limit-safe batches** — read a group of games
  the throttle can handle, continue until all are read, menu populates
  progressively, then the existing elimination/scoring runs (§8).
- **Band tiers: adaptive** to what the board actually reaches that night.
- **TUI ↔ engine: via the localhost API** (the same validated build/log flow),
  not in-process.
- **Execution-ready gating (requirement):** a band is "buildable" only if its legs
  have confirmed UI rowIds from the candidate pool; non-executable constructions
  are flagged, never silently built.
- **`Failed to fetch` recovery: wait** — the shipped retry/backoff is the first
  line; add page-reload / Cloudflare re-clear only if failures persist in practice.

Nothing outstanding — Phase 1 (read-only slate-scan + band screen) is ready to
start.

## 13. Where the TUI lives (structure)
One app, one launcher, navigable screens — the cleanest single-entry experience.

```
OCLAY/
  Oclay.bat                 # single double-click entry (already exists), repo root
  app/
    local_helper_tui.py     # existing Textual app shell (ops: helper / clean)
    decision_tui.py         # NEW: the bands / decision screen (Textual)
    ... engine + API ...
  docs/local-dashboard-design.md
```

- **Code:** the bands screen is a **new module under `app/`**, part of the
  existing Textual app — not a separate program.
- **Launch:** the **same `Oclay.bat`** at the repo root you already use. It opens
  the TUI; a **"Bands"** menu entry goes to the decision screen. No new top-level
  clutter — one mental model: "double-click Oclay, it's all in there." (An optional
  `Oclay_Bands.bat` could jump straight to the screen, but isn't needed.)
- **API:** `Oclay.bat` → `start-oclay-all.ps1` already starts the local API in the
  background alongside the TUI, so the bands screen just calls
  `http://127.0.0.1:8000` — no extra process to manage. (With the GPT removed, the
  tunnel is no longer needed for the product, only the local API.)

## 14. TUI flow & screens (start to finish)

The guiding rule: **everything is a Review (a preview) until you press Build.**
"Review" and "Build" are *roles*, not an upfront fork — you never re-scan to go
from looking to placing.

### End-to-end
```
Main menu ──Start (ctrl+s)──► Decision screen
   │                              │
   │   Chrome (already alive) navigates to the Stake MLB fixtures page,
   │   the batched scan begins, and the engine scores boards as they land
   │   (progressive). The adaptive band menu fills in with real reachable
   │   magnitudes + a Custom target input.
   │                              │
   │   Pick a band ──► slip already computed by the frontier ──► rich preview
   │                              │
   │              [ Build ]  [ Re-roll ]  [ Back ]
   │                  │
   │   Build ──► validate ──► click legs into the real Stake slip ──►
   │            show REAL Stake quote vs estimate ──► auto-log ──► you place.
   └─────────────────────────────────────────────────────────────────────────
```

Step list: **Start → decision screen (Chrome opens + batched scan + engine) →
adaptive band menu / custom target → instant rich preview → Build → real-quote →
place.**

### Screen 1 — Main menu (decluttered)
Review/Build are gone from here; `Start` replaces them.
```
  OCLAY  [ready]
  ─────────────────────────────
  Start    ctrl+s     Trainer  ctrl+t
  Clean    ctrl+c     Honest   ctrl+h
  Domain   ctrl+q     ROI      ctrl+p
  Stop     ctrl+d     RGB      ctrl+g
  Exit     ctrl+e
  Job queue: Local SQLite (idle)
```

### Screen 2 — Decision screen (scan + band menu)
```
  ┌ OCLAY — Decision ─────────────────────────────────┐
  │ Scanning games…  6/15   (rate-limit safe, batched)│
  │                                                   │
  │ Target band:                                      │
  │   50x    500x    5,000x    ~90,000x (max tonight) │
  │   ▸ Custom: [ 50k        ]                        │
  │                                                   │
  │ States: Generating candidate pools… ▸ Selecting   │
  │         final legs…                               │
  └───────────────────────────────────────────────────┘
```
Adaptive: the menu only shows magnitudes the board actually reaches; an
unreachable custom target shows "best reachable: ~90k."

### Screen 3 — Rich slip preview (this is "Review")
```
  ┌ Slip preview ─────────────────────────────────────┐
  │ Mode: Build      Target: 50,000x                  │
  │ Structure: 2 unders per game / 15-game build (50x³)│
  │ Est. odds: ~52,400x   Win prob: 0.9–1.4%          │
  │ EV range: +0.03 / −0.08                           │
  │                                                   │
  │  Game 1 — Phillies @ Marlins                      │
  │   • J. Realmuto  Hits   U1.5  1.74   edge +6%     │
  │   • B. Marsh     TB     U1.5  1.91   sharp ✓      │
  │  Game 2 — Yankees @ Red Sox                       │
  │   • A. Judge     TB     U1.5  1.80   stale-line ✓ │
  │   • …                                             │
  │                                                   │
  │ [ Build ]   [ Re-roll ]   [ Back ]                │
  └───────────────────────────────────────────────────┘
```
Grouped by game, per-leg edge/why, slip-level win-prob + EV range. Polished rich
panels (Textual), not terminal spam.

### Screen 4 — After Build
Legs are clicked into the real Stake slip; the screen shows the **real combined
Stake quote vs the estimate** (the real-quote check), confirms auto-log, and hands
off to you to review/place in Stake. Review-only — never enters a stake amount or
clicks the final wager button.

### States (polished, never crashes)
`Scanning games… n/15` · `Generating candidate pools…` · `Selecting final legs…` ·
`Building slip…` · `Stake is throttling — cooling down (11/15 scanned)` ·
`Best reachable: ~90k` · `No edge tonight at this band`.

## 15. Hotkeys & menu map

| Action | Old key | New key | Notes |
| --- | --- | --- | --- |
| **Start** | — (new) | **`ctrl+s`** | replaces Review/Build on the main menu |
| **Stop** | `ctrl+s` | **`ctrl+d`** | moved to free `ctrl+s` for Start |
| Review | `ctrl+r` | — | leaves the main menu; becomes the *preview* inside Start |
| Build | `ctrl+b` | — | leaves the main menu; becomes the *Build button* inside Start |
| Trainer | `ctrl+t` | `ctrl+t` | unchanged |
| Honest | `ctrl+h` | `ctrl+h` | unchanged |
| ROI | `ctrl+p` | `ctrl+p` | unchanged |
| Clean | `ctrl+c` | `ctrl+c` | unchanged |
| Domain | `ctrl+q` | `ctrl+q` | unchanged |
| RGB | `ctrl+g` | `ctrl+g` | unchanged |
| Exit | `ctrl+e` | `ctrl+e` | unchanged |

`ctrl+z` was rejected (it conventionally means undo / suspend-process and can
freeze the app). The rebind + the Review/Build menu removal land **together in
build step 8**, not in isolation now — changing one key before the menu reorg
would desync the live TUI from this plan.
