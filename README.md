# AI-PA, personal AI agent

Secure, extensible assistant. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status (honest)
| Capability | State |
|---|---|
| Policy modes A/B/C, bound approvals, idempotency, verification, cancellation, hash-chained audit | **Implemented, 13 tests** |
| Untrusted-content wrapper and injection flagging | Implemented (heuristic; defence in depth, not a guarantee) |
| DB schema + Postgres store (atomic approval consumption, no resurrecting cancelled tasks) | **Implemented, tested on real Postgres 16** |
| Sessions (hashed tokens, expiry, revoke, revoke-all), AES-256-GCM token encryption | Implemented, tested |
| Gmail tools: search, read thread (untrusted-wrapped), draft reply, send reply in-thread with verification | Implemented; tested **only against a fake Gmail HTTP layer**, not the real service |
| Google + Microsoft OAuth (PKCE, state check, offline refresh, encrypted storage, auto-refresh, disconnect/revoke) | Implemented; flow logic tested with fake token endpoints, **not yet run with real Google/Microsoft credentials** |
| Outlook / live.com tools (Graph): search, read, draft reply, send reply with Sent-Items verification | Implemented; tested **only against a fake Graph layer** |
| Owner sign-in (token), rate limit, session cookie; connect/disconnect UI | Implemented; smoke-tested against a real running server and Postgres |
| Audit-log persistence to Postgres | **Not built yet** |
| Web UI | Sign-in, connect/disconnect mailboxes, mode descriptions. No task or approval screen yet |
| LLM planner, Outlook, calendar, browser, travel, WhatsApp, jobs, voice | **Not built yet** |

Nothing in the UI is simulated data.

## Develop
```
npm install
npm test         # vitest; set TEST_DATABASE_URL (migrated DB) to include Postgres tests
npm run typecheck
npm run dev
```
Copy `.env.example` to `.env.local`.

## Accounts and credentials you will need
Google Cloud OAuth client (Gmail, Calendar), Microsoft Entra app (Outlook), an LLM API key, Postgres, Redis, a flight API (Amadeus or Duffel), WhatsApp Business Platform account (business use only).

## Known limitation
The audit log hash chain is in-process. Persisting it from several processes needs a serialized writer (e.g. advisory lock) before multi-instance deployment.

## Linking Gmail and Outlook / live.com
1. **Google:** Cloud Console > new project > enable Gmail API > OAuth consent screen (External, Testing; add your address as a test user) > Credentials > OAuth client ID (Web). Redirect URI: `APP_URL/api/oauth/callback/google`. Note: in Testing mode Google expires refresh tokens after 7 days; publish the app (or verify it) for longer-lived access.
2. **Microsoft:** Entra admin center > App registrations > New. Supported account types: *Accounts in any organizational directory and personal Microsoft accounts*. Redirect URI (Web): `APP_URL/api/oauth/callback/microsoft`. Create a client secret. API permissions: Microsoft Graph delegated `Mail.ReadWrite`, `Mail.Send`, `User.Read`, `offline_access`.
3. Fill `.env.local` (see `.env.example`), generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`, run migrations, `npm run dev`, sign in with `ADMIN_BOOTSTRAP_TOKEN`, click the connect links.
4. Disconnect revokes the token at Google. Microsoft has no token-revocation endpoint: tokens are wiped here, and you can also remove the app at account.live.com/consent/Manage.
