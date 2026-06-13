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

## Permanent URL (recommended — set the GPT once, never copy-paste again)

The quick tunnel hands out a new URL each run. To get a **fixed** URL for free:

1. Make a free account at **https://dashboard.ngrok.com** (no card needed).
2. Copy your **authtoken** from the dashboard and run it once:
   `.\.tools\ngrok.exe config add-authtoken <YOUR_TOKEN>`
3. In the ngrok dashboard, open **Domains** and **claim your free static domain**
   (e.g. `oclay-yourname.ngrok-free.app`).
4. Put it in `.env`:  `OCLAY_NGROK_DOMAIN=oclay-yourname.ngrok-free.app`
5. Set the GPT Action server URL to `https://oclay-yourname.ngrok-free.app` and
   re-import `…/gpt/openapi.json` **one time**.

From then on, `Oclay_API.bat` always serves that same URL — you never touch the
GPT Action again. (If `OCLAY_NGROK_DOMAIN` is blank, it falls back to the quick
tunnel.)

## Every day

- Just run **`Oclay.bat`**. It starts the local API and the tunnel automatically
  alongside the TUI. By default they run **completely hidden** — no window, no
  taskbar entry, visible only in Task Manager — so you only see the main TUI
  window. When you **close the TUI window, the API and tunnel shut down with it.**
  With the ngrok domain set, there's nothing to copy or repaste — one launcher, done.
- **Debugging:** to watch the API/tunnel logs, set `SHOW_BACKGROUND_TERMINALS=true`
  in `.env`. They'll open as visible (minimized) windows instead of hidden. Set it
  back to `false` (the default) to hide them again.
- `Oclay_API.bat` still exists if you ever want to run the API + tunnel on their
  own (in visible windows) without the TUI.
- First-time only: if you haven't set the ngrok domain yet, either set
  `SHOW_BACKGROUND_TERMINALS=true` to see the **Oclay Tunnel** window, or just run
  `Oclay_API.bat`, to copy the temporary URL.

## Render

Once the GPT points at the tunnel, it never calls Render again — repointing *is*
the cutover. You can suspend or delete the Render service in the Render dashboard
to be certain and to stop it consuming free hours. Nothing local depends on it.
