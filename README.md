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
| Gmail OAuth flow (consent, callback, token refresh), login UI, audit-log persistence to Postgres | **Not built yet** |
| Web shell | Static page only |
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
