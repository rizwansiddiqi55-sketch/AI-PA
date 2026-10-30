# AI-PA, personal AI agent

Secure, extensible assistant. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Status (honest)
| Capability | State |
|---|---|
| Policy modes A/B/C, bound approvals, idempotency, verification, cancellation, hash-chained audit | **Implemented, 13 tests** |
| Untrusted-content wrapper and injection flagging | Implemented (heuristic; defence in depth, not a guarantee) |
| DB schema | Written; not yet run against a live Postgres |
| Web shell | Static page only |
| Auth, Postgres store, LLM planner, Gmail/Outlook, calendar, browser, travel, WhatsApp, jobs, voice | **Not built yet** |

Nothing in the UI is simulated data.

## Develop
```
npm install
npm test         # vitest
npm run typecheck
npm run dev
```
Copy `.env.example` to `.env.local`.

## Accounts and credentials you will need
Google Cloud OAuth client (Gmail, Calendar), Microsoft Entra app (Outlook), an LLM API key, Postgres, Redis, a flight API (Amadeus or Duffel), WhatsApp Business Platform account (business use only).
