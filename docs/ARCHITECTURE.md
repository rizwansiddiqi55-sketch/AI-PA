# AI-PA Architecture

Approach: **C, hybrid.** A custom agent owns persistent workflows, integrations, permissions and the audit trail. An LLM (tool-calling API) supplies planning and language; it never holds credentials or acts outside the policy engine.

## 1. Components

```
PWA (Next.js, iPhone/laptop) ──HTTPS──> API (Next.js route handlers)
                                           │
 Planner (LLM, structured output) ──> Executor ──> Policy ──> Tool registry ──> Integrations
                                           │          │             (Gmail, Outlook, Calendar,
                                           │          └ Approvals    WhatsApp, flights, Playwright)
                                           ├ Verifier (tool.verify, authoritative re-read)
                                           ├ Audit log (hash-chained, per account)
                                           └ Store port ──> PostgreSQL;  Redis queue for background tasks
```

Implemented in `src/core/`: `policy.ts` (modes A/B/C), `approval.ts` (action-bound hashes), `executor.ts` (approval, idempotency, verification, cancellation), `audit.ts`, `untrusted.ts`, `store.ts` (port).

Agent roles map to code: **Planner** (LLM, Phase 2), **Executor** (done), **Verifier** (`tool.verify`, done), **Memory** (`memories` table), **Security/Approval** (`policy` + `approval`, done), **Integration layer** (tool registry; one module per provider).

## 2. Folder structure

```
src/core/          policy, approvals, executor, audit, untrusted-content handling
src/integrations/  gmail/ outlook/ gcal/ whatsapp/ travel/ browser/ jobs/   (Phase 2+)
src/agents/        planner, briefing                                         (Phase 2+)
src/app/           Next.js UI + API routes
db/migrations/     SQL
tests/             vitest
docs/              this file
```

## 3. Database
See `db/migrations/0001_init.sql`: accounts (mode and limits), sessions (hashed tokens, revocable), integrations (encrypted OAuth tokens), tasks, approvals, executions (idempotency), audit_log, memories (preference vs expiring task context).

## 4. Integration and permission matrix

| Capability | Read | Draft | Send/Write | Needs approval (Mode B) | Mode C eligible | Status |
|---|---|---|---|---|---|---|
| Gmail / Outlook mail | yes | yes | send in-thread | yes | trusted recipients, routine only | Phase 2 |
| Calendar | yes | n/a | create/edit/cancel | yes | create on free slots | Phase 3 |
| Browser (Playwright) | yes | n/a | form fill | yes | no | Phase 4 |
| Flights | search | itinerary | book | always | never | Phase 5 |
| WhatsApp | business API only | yes | business API only | yes | trusted contacts | Phase 6 |
| Jobs | search/score | CV/cover letter | submit | yes | never | Phase 7 |

Always-approve categories (enforced in code): payment, booking, sensitive data, account change, legal/financial, obligations.

## 5. Roadmap
Phases 1 to 8 as in the product brief. Done: engine, schema, shell. Next: auth + Postgres store, then Gmail (OAuth, read/summarise/draft/in-thread reply).

## 6. Main risks
1. **Prompt injection via email/web/WhatsApp.** Mitigation: content wrapped as untrusted, authority only from policy and bound approvals.
2. **WhatsApp.** The Business Platform serves business numbers, not a personal account or existing chats. Personal-chat automation is unsupported; fallback is share-sheet and notification drafts.
3. **iOS background limits.** A PWA cannot run in the background; long tasks run in the cloud, and push notifications bring you back for approvals.
4. **Booking correctness and money.** Always-approve, hash-bound to price and itinerary; re-quote check before purchase.
5. **OAuth verification.** Google restricted Gmail scopes require app verification and a security assessment for public use; fine for a single-user app in testing mode.
6. **Browser automation fragility, CAPTCHAs, MFA.** Prefer APIs; stop and hand over rather than bypass.
