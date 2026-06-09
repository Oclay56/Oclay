# OCLAY

Oclay is a simplified AI-led MLB review-slip system built from the useful Stake-GPT core. It keeps the Stake board reader, MLB context, market-neutral SGM candidate logic, rowId validation, Chrome helper, Supabase UI-job bridge, and Render/FastAPI deployment path.

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

## Supabase

The simple Oclay schema keeps only:

- `market_mappings`
- `local_ui_jobs`

Apply `supabase/gpt_action.sql` to the Oclay Supabase project before using the local helper bridge.
