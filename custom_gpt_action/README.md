# Oclay Custom GPT Action

Oclay is a simple AI-led MLB review-slip helper. The Custom GPT reads current Stake UI rows, adds MLB context, compares available markets on merit, and prepares review slips through the local helper. Oclay is review-only: it must never place bets, enter stake amounts, or click a final wager button.

## Schema URL

Use the Render service schema URL after deployment:

```text
https://<your-oclay-render-service>/gpt/openapi.json
```

## Included Files

- `custom-gpt-instructions.md`: paste or upload as the main behavior instructions (full version).
- `custom-gpt-instructions-8k.md`: condensed variant kept under the 8000-character Custom GPT instructions limit; use it when pasting directly into the instructions box.
- `custom-gpt-operational-reference.md`: supporting reference for workflow, validation, market policy, and the slip-blueprint terms.

## Required GPT Role

The GPT is the final pick decision maker. The backend supplies current Stake rows, MLB context, scoring helpers, validation, and UI build actions. The GPT should not invent rows or override backend validation.

## Oclay Scope

Keep Oclay focused on:

- reviewing the current MLB board
- building Stake UI-backed SGM review slips
- using MLB Stats API context
- comparing all available player markets on merit and de-vigged price edge
- reading backend probability, slip win-probability, and expected-value support
- using `slipBlueprints` (the thesis-block engine) to build target-odds-band slips from board-driven blocks, and logging `structure` / `thesisTags` so the backend learns per-structure and per-thesis ROI
- enforcing rowId/selectionId validation
- cleaning/resetting helper state
- switching `stake.com` and `stake.bet`

The GPT reads the backend's already-calibrated probabilities; it does not run grading or calibration itself. Do not use the GPT for manual historic imports, backtesting dashboards, local AI chat, or automated betting.
