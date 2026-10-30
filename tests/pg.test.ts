import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { z } from "zod";
import { AuditLog } from "../src/core/audit";
import { Executor } from "../src/core/executor";
import { PgStore } from "../src/db/pg-store";
import { Sessions } from "../src/security/sessions";
import type { ToolDefinition } from "../src/core/types";

// Requires a migrated database: TEST_DATABASE_URL=postgres://... npm test
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("Postgres store and sessions (real database)", () => {
  let pool: Pool, store: PgStore, accountId: string;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const r = await pool.query("INSERT INTO accounts(email) VALUES ($1) RETURNING id", [`t${Date.now()}@example.com`]);
    accountId = r.rows[0].id;
    store = new PgStore(pool);
  });
  afterAll(async () => { await pool.query("DELETE FROM accounts WHERE id=$1", [accountId]); await pool.end(); });

  it("runs the full approve-then-execute-once flow on Postgres", async () => {
    let runs = 0;
    const tool: ToolDefinition<{ to: string }, { ok: true }> = {
      name: "t.send", description: "t", effect: "external", input: z.object({ to: z.string() }),
      describe: (i) => ({ recipient: i.to, summary: `to ${i.to}` }),
      run: async () => { runs++; return { ok: true }; },
      verify: async () => ({ ok: true, evidence: "ok" }),
    };
    const ex = new Executor(store, new AuditLog(), () => ({ mode: "execute_with_approval", autonomousTools: [], trustedRecipients: [], maxAmountMinor: 0 }));
    ex.register(tool as ToolDefinition);
    const task = await store.createTask(accountId, "send a thing");
    const p = { taskId: task.id, accountId, tool: "t.send", input: { to: "a@b.c" } };
    const r1 = await ex.execute(p);
    expect(r1.status).toBe("awaiting_approval");
    if (r1.status !== "awaiting_approval") throw new Error();
    expect((await store.getTask(task.id))?.status).toBe("awaiting_approval");
    await ex.decideApproval(accountId, task.id, r1.approvalId, true);
    expect((await ex.execute(p)).status).toBe("completed");
    expect(await ex.execute(p)).toMatchObject({ status: "completed", duplicate: true });
    expect(runs).toBe(1);
    expect((await store.getTask(task.id))?.status).toBe("completed");
  });

  it("consumeApproval is atomic: only one concurrent caller wins", async () => {
    const task = await store.createTask(accountId, "race");
    await store.saveApproval({ id: crypto.randomUUID(), taskId: task.id, actionHash: "h", summary: "s", status: "approved", expiresAt: Date.now() + 60_000 });
    const a = (await store.findApproval(task.id, "h"))!;
    const wins = (await Promise.all([store.consumeApproval(a.id), store.consumeApproval(a.id), store.consumeApproval(a.id)])).filter(Boolean);
    expect(wins).toHaveLength(1);
  });

  it("a cancelled task cannot be resurrected", async () => {
    const task = await store.createTask(accountId, "c");
    await store.setTaskStatus(task.id, "cancelled");
    await store.setTaskStatus(task.id, "running");
    expect((await store.getTask(task.id))?.status).toBe("cancelled");
  });

  it("sessions: verify, expire, revoke", async () => {
    const s = new Sessions(pool);
    const tok = await s.create(accountId);
    expect(await s.verify(tok)).toBe(accountId);
    expect(await s.verify("bogus")).toBeUndefined();
    await s.revoke(tok);
    expect(await s.verify(tok)).toBeUndefined();
    const short = await new Sessions(pool, 1).create(accountId);
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.verify(short)).toBeUndefined();
    const t2 = await s.create(accountId);
    await s.revokeAll(accountId);
    expect(await s.verify(t2)).toBeUndefined();
  });
});
