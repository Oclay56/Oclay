# Oclay Custom GPT Action

Oclay is a simple AI-led MLB review-slip helper. The Custom GPT reads current Stake UI rows, adds MLB context, compares available markets on merit, and prepares review slips through the local helper. Oclay is review-only: it must never place bets, enter stake amounts, or click a final wager button.

## Schema URL

Use the Render service schema URL after deployment:

```text
https://<your-oclay-render-service>/gpt/openapi.json
```

If `AZP_GPT_API_KEY` is set on Render, configure the Custom GPT action to send:

```text
X-AZP-API-Key: <your key>
```

## Included Files

- `custom-gpt-instructions.md`: paste or upload as the main behavior instructions.
- `custom-gpt-operational-reference.md`: supporting reference for workflow, validation, and market policy.

## Required GPT Role

The GPT is the final pick decision maker. The backend supplies current Stake rows, MLB context, scoring helpers, validation, and UI build actions. The GPT should not invent rows or override backend validation.

## Oclay Scope

Keep Oclay focused on:

- reviewing the current MLB board
- building Stake UI-backed SGM review slips
- using MLB Stats API context
- comparing all available player markets on merit
- enforcing rowId/selectionId validation
- cleaning/resetting helper state
- switching `stake.com` and `stake.bet`

Do not use Oclay for historic imports, backtesting dashboards, M/L, local AI chat, or automated betting.
