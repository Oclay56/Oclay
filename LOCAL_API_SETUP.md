# Run Oclay all-local (GPT logs into the same ledger you train on)

By default the Custom GPT talked to a Render backend with its own ephemeral
ledger — separate from your local history, and wiped on every redeploy. This
points the GPT at your **local** backend instead, so everything (logging,
grading, calibration, your imported history) lives in one durable place:
`data/pick_ledger.sqlite`.

```
Custom GPT  ->  Cloudflare tunnel  ->  local API (127.0.0.1:8000)  ->  local ledger
                                                  |
                                                  +->  Supabase job queue  ->  local helper (scraping)
```

## One-time setup

1. **Start the local API + tunnel:** double-click **`Oclay_API.bat`**.
   Two windows open:
   - *Oclay API* — the backend on `http://127.0.0.1:8000`.
   - *Oclay Tunnel* — prints a public URL like `https://something.trycloudflare.com`.
   (The first run downloads `cloudflared` automatically.)

2. **Copy the tunnel URL** (the `https://….trycloudflare.com` line).

3. In the **Custom GPT editor → Actions**:
   - Set the **server URL** to that tunnel URL.
   - Re-import / refresh the schema from `https://….trycloudflare.com/gpt/openapi.json`.
   - Confirm `recordSlip` now shows a **`legs`** parameter.

4. **Test:** ask the GPT to log a slip. It should return `recorded: true`, and the
   slip now lands in your local ledger — run **Trainer** (Ctrl+T) and it will grade.

## Every day

- Keep the two windows (API + Tunnel) open while you use the GPT, alongside the
  normal Oclay TUI (`Oclay.bat`) for board scraping.
- The free "quick tunnel" URL **changes each time you restart the tunnel**. If you
  restart it, repeat steps 2–3 with the new URL. (Leaving it running keeps the
  same URL. A permanent URL needs a named Cloudflare tunnel — ask to set that up.)

## Render

Once the GPT points at the tunnel, it never calls Render again — repointing *is*
the cutover. You can suspend or delete the Render service in the Render dashboard
to be certain and to stop it consuming free hours. Nothing local depends on it.
