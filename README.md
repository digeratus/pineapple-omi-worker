# Pineapple Omi Worker

This project is a deployed Cloudflare Worker endpoint for an Omi integration app. Omi sends real-time transcript webhook events to the Worker, and the Worker returns an Omi proactive notification when a transcript segment contains the whole word `pineapple`.

The endpoint is public, so it requires a shared token in the webhook URL. It also uses a Cloudflare Durable Object to keep a consistent 30-second cooldown per Omi `uid` or session, which prevents duplicate transcript events from creating repeated notifications.

## Current Deployment

The Worker has been deployed and validated at:

```text
https://pineapple-omi-worker.awar3.workers.dev
```

Set this as the Omi Real-Time Transcript Webhook:

```text
https://pineapple-omi-worker.awar3.workers.dev/webhook?token=<WEBHOOK_TOKEN>
```

Validation completed:

- `GET /health` returned `{"status":"ok","trigger_word":"pineapple","cooldown_seconds":30}`.
- An authorized test webhook containing `pineapple` returned an Omi `notification` payload.

## Configure Omi

In the Omi mobile app:

1. Enable Developer Mode.
2. Open Developer Settings.
3. Set the Real-Time Transcript Webhook to:

```text
https://pineapple-omi-worker.awar3.workers.dev/webhook?token=<WEBHOOK_TOKEN>
```

4. Create or edit your Omi app with these capabilities:

```json
{
  "capabilities": ["external_integration", "proactive_notification"],
  "external_integration": {
    "triggers_on": "transcript_processed",
    "webhook_url": "https://pineapple-omi-worker.awar3.workers.dev/webhook?token=<WEBHOOK_TOKEN>"
  },
  "proactive_notification": {
    "scopes": ["user_name"]
  }
}
```

5. Speak a sentence containing `pineapple`.
6. Confirm Omi shows the notification.

## Omi Submission Fields

Use these values when submitting the app:

- App Name: `SafeWord` or `Pineapple Alert`
- Category: `Safety`
- Description: `Sends an Omi notification when the word pineapple is detected in live transcript audio.`
- App Icon: upload `assets/app-icon.png`
- Capabilities: turn on `External Integration` and `Smart Notifications`; leave `Chat` and `Conversations` off.
- Trigger Event: `Real-time Transcript` or `Transcript Processed`
- Webhook URL: `https://pineapple-omi-worker.awar3.workers.dev/webhook?token=<WEBHOOK_TOKEN>`
- App Home URL: leave blank if allowed; otherwise use `https://pineapple-omi-worker.awar3.workers.dev/health`
- Setup Instructions: `No setup required. Install this app, keep your Omi device connected, and say "pineapple" during a conversation. The app sends an Omi notification when the safe word is detected.`
- Auth URL: leave blank
- Setup Completed URL: leave blank
- Chat Tools Manifest URL: leave blank
- Notification Scopes: turn on `User Name`; leave `User Facts`, `User Conversations`, and `User Chat` off.
- GitHub Repository URL: `https://github.com/digeratus/pineapple-omi-worker`
- Make Public: off while testing
- Paid app: off

## How It Works

- `GET /health` returns basic service status.
- `POST /webhook` accepts Omi transcript webhook payloads.
- The webhook accepts either a raw segment array or an object with `session_id` and `segments`.
- The Worker detects `pineapple` case-insensitively as a whole ASCII word.
- The Worker returns only `{ "session_id": "..." }` when the trigger word is absent or the session/user is in cooldown.
- The Worker returns a proactive notification payload when the trigger word is detected.
- `CooldownGate` is a Durable Object using SQLite-backed storage to enforce the 30-second cooldown consistently across Cloudflare locations.

The public Omi app docs do not expose a DevKit 2 API for directly controlling the device speaker, vibration, or LEDs, so this Worker uses the supported Omi push notification path.

## Project Files

- `assets/app-icon.png` - generated shield and pineapple app icon for Omi upload.
- `src/index.ts` - Worker routes, token authentication, transcript parsing, trigger detection, and `CooldownGate`.
- `wrangler.jsonc` - Production Cloudflare Worker config, Durable Object binding, migration, and observability.
- `wrangler.test.jsonc` - Test-only Worker config with a disposable `test-token`.
- `test/webhook.test.ts` - Worker runtime tests.
- `.dev.vars.example` - Local development secret template.

## Local Development

Install dependencies:

```bash
npm install
```

Generate Cloudflare binding types:

```bash
npm run types
```

Create a local-only secret file:

```bash
cp .dev.vars.example .dev.vars
```

Set `WEBHOOK_TOKEN` in `.dev.vars` to any local test value.

Run locally:

```bash
npm run dev
```

Local health check:

```text
http://127.0.0.1:8787/health
```

Local webhook shape:

```text
http://127.0.0.1:8787/webhook?token=<WEBHOOK_TOKEN>
```

## Validate Changes

Before deploying changes, run:

```bash
npm run types
npm run typecheck
npm test
npm run dry-run
```

## Deploy Updates

Wrangler was logged in using a workspace-local Cloudflare config path because this sandbox could not write to the default macOS Wrangler preferences directory. Use the same environment variable when deploying from this machine:

```bash
XDG_CONFIG_HOME="$PWD/.config" npm run deploy
```

If you need to rotate the production webhook token:

```bash
python3 - <<'PY' > /private/tmp/omi_webhook_token
import secrets
print(secrets.token_urlsafe(32))
PY
XDG_CONFIG_HOME="$PWD/.config" WRANGLER_LOG_PATH=.wrangler/wrangler.log npx wrangler secret put WEBHOOK_TOKEN < /private/tmp/omi_webhook_token
XDG_CONFIG_HOME="$PWD/.config" npm run deploy
cat /private/tmp/omi_webhook_token
```

After rotating, update the Omi webhook URL with the new token.
