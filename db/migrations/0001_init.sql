-- Phase 1 foundation. PostgreSQL 15+. Not yet executed against a live database.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  mode          text NOT NULL DEFAULT 'execute_with_approval'
                CHECK (mode IN ('read_recommend','execute_with_approval','limited_autonomous')),
  autonomous_tools    text[] NOT NULL DEFAULT '{}',
  trusted_recipients  text[] NOT NULL DEFAULT '{}',
  max_amount_minor    bigint NOT NULL DEFAULT 0,
  retention_days      int NOT NULL DEFAULT 90,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,          -- store only a hash of the session token
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  device      text
);

-- OAuth connections. Tokens are encrypted at the application layer (envelope encryption, key in KMS).
CREATE TABLE integrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider       text NOT NULL,              -- gmail | outlook | gcal | outlook_cal | whatsapp | ...
  external_id    text NOT NULL,              -- which external account performed actions
  scopes         text[] NOT NULL,
  token_cipher   bytea NOT NULL,
  status         text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked','error')),
  connected_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider, external_id)
);

CREATE TABLE tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instruction  text NOT NULL,
  plan         jsonb NOT NULL DEFAULT '[]',
  status       text NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','running','awaiting_approval','completed','failed','cancelled')),
  runs_in      text NOT NULL DEFAULT 'cloud' CHECK (runs_in IN ('cloud','needs_browser_session')),
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_account_status ON tasks(account_id, status);

CREATE TABLE approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action_hash  text NOT NULL,                 -- sha256 over account+tool+input+recipient+amount+currency
  summary      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected','consumed')),
  expires_at   timestamptz NOT NULL,
  decided_at   timestamptz
);
CREATE INDEX approvals_lookup ON approvals(task_id, action_hash);

-- Idempotency: one verified execution per action hash.
CREATE TABLE executions (
  action_hash  text PRIMARY KEY,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  result       jsonb,
  evidence     text NOT NULL,
  executed_at  timestamptz NOT NULL DEFAULT now()
);

-- Append-only, hash-chained. Revoke UPDATE/DELETE from the app role.
CREATE TABLE audit_log (
  seq         bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  account_id  uuid NOT NULL,
  task_id     uuid,
  event       text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}',
  prev_hash   text NOT NULL,
  hash        text NOT NULL
);

-- Long-term preferences are separate from temporary task context.
CREATE TABLE memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('preference','task_context')),
  key         text NOT NULL,
  value       jsonb NOT NULL,
  approved    boolean NOT NULL DEFAULT false,  -- only user-approved items are persisted long term
  expires_at  timestamptz,                     -- task_context expires; preferences do not
  UNIQUE (account_id, kind, key)
);
