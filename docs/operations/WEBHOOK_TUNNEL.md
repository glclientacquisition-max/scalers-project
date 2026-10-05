# Exposing port 3000 for SautiKit webhooks

SautiKit must reach `POST /voice/incoming` over public HTTPS. Localtunnel’s
anti-phishing splash page often blocks automated webhooks **before** they hit
`node server.js`.

## Why `Bypass-Tunnel-Reminder` does not fix SautiKit

`Bypass-Tunnel-Reminder: true` is a **request** header the *client* must send
when calling your tunnel URL. Our Express app cannot add it to inbound SautiKit
POSTs. Only SautiKit (or a browser you control) can send that header — so a
`tunnel.js` “inject” cannot unblock their webhooks.

## Option A — Cloudflare Tunnel (recommended)

Terminal 1:

```bash
npm start
```

Terminal 2:

```bash
npm run tunnel:cloudflared
```

Copy the printed `https://….trycloudflare.com` URL and set SautiKit:

```text
voice_callback_url = https://….trycloudflare.com/voice/incoming
```

No splash page; works with automated POSTs and WSS upgrades to `/ws/media`.

## Option B — Localtunnel (not recommended for SautiKit)

```bash
npm start
npm run tunnel:localtunnel
# optional sticky name: SUBDOMAIN=my-hook npm run tunnel:localtunnel
```

Use only for manual browser checks. Expect missing `INCOMING REQUEST` logs when
SautiKit is blocked by the interstitial.

## Option C — Cursor / VS Code Ports tab

If you are running the server inside **Cursor Desktop** (or a Codespaces-like
remote), you can expose port 3000 without Localtunnel:

1. Start the server: `npm start` (listens on `3000`).
2. Open the **Ports** panel (Command Palette → “Ports: Focus on Ports View”,
   or the “Ports” tab next to Terminal).
3. If `3000` is not listed, click **Forward a Port** and enter `3000`.
4. Right-click the port → **Port Visibility** → **Public**
   (Visibility must be Public for SautiKit’s servers to reach it).
5. Copy the generated HTTPS URL (e.g. `https://….cursor.sh` / forwarded host).
6. Set SautiKit `voice_callback_url` to `https://<forwarded-host>/voice/incoming`.

Notes:

- Private/visibility “loopback” URLs only work from your machine — SautiKit needs **Public**.
- Keep the Ports row active while testing; stopping the forward drops the webhook.
- Confirm hits with the diagnostic middleware (`INCOMING REQUEST` in server logs).

## Verify

```bash
curl -sS -X POST "https://<public-host>/voice/incoming" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "CallSid=TEST&From=%2B254700000001"
```

You should receive XML `<Connect><Stream …/></Connect>` and see an
`INCOMING REQUEST` line in the server terminal.
