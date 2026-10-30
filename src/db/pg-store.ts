import type { Pool } from "pg";
import type { ExecutionRecord, Store, TaskRecord } from "../core/store";
import type { Approval, TaskStatus } from "../core/types";

export class PgStore implements Store {
  constructor(private pool: Pool) {}

  async createTask(accountId: string, instruction: string): Promise<TaskRecord> {
    const r = await this.pool.query("INSERT INTO tasks(account_id, instruction) VALUES ($1,$2) RETURNING id, account_id, status", [accountId, instruction]);
    return toTask(r.rows[0]);
  }

  async getTask(id: string) {
    const r = await this.pool.query("SELECT id, account_id, status FROM tasks WHERE id=$1", [id]);
    return r.rows[0] ? toTask(r.rows[0]) : undefined;
  }

  async setTaskStatus(id: string, status: TaskStatus) {
    // A cancelled task stays cancelled: late writers must not resurrect it.
    const guard = status === "cancelled" ? "" : " AND status <> 'cancelled'";
    await this.pool.query(`UPDATE tasks SET status=$2, updated_at=now() WHERE id=$1${guard}`, [id, status]);
  }

  async saveApproval(a: Approval) {
    await this.pool.query(
      `INSERT INTO approvals(id, task_id, action_hash, summary, status, expires_at, decided_at)
       VALUES ($1,$2,$3,$4,$5,to_timestamp($6/1000.0), CASE WHEN $7::bigint IS NULL THEN NULL ELSE to_timestamp($7/1000.0) END)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, decided_at=EXCLUDED.decided_at`,
      [a.id, a.taskId, a.actionHash, a.summary, a.status, a.expiresAt, a.decidedAt ?? null],
    );
  }

  async getApproval(id: string) {
    const r = await this.pool.query(APPROVAL_SELECT + " WHERE id=$1", [id]);
    return r.rows[0] ? toApproval(r.rows[0]) : undefined;
  }

  async findApproval(taskId: string, actionHash: string) {
    const r = await this.pool.query(
      APPROVAL_SELECT + " WHERE task_id=$1 AND action_hash=$2 AND status IN ('pending','approved') ORDER BY expires_at DESC LIMIT 1",
      [taskId, actionHash],
    );
    return r.rows[0] ? toApproval(r.rows[0]) : undefined;
  }

  async consumeApproval(id: string) {
    const r = await this.pool.query("UPDATE approvals SET status='consumed' WHERE id=$1 AND status='approved' RETURNING id", [id]);
    return r.rowCount === 1;
  }

  async getExecution(actionHash: string) {
    const r = await this.pool.query("SELECT action_hash, task_id, result, evidence FROM executions WHERE action_hash=$1", [actionHash]);
    const row = r.rows[0];
    return row ? ({ actionHash: row.action_hash, taskId: row.task_id, result: row.result, evidence: row.evidence } as ExecutionRecord) : undefined;
  }

  async saveExecution(e: ExecutionRecord) {
    await this.pool.query(
      "INSERT INTO executions(action_hash, task_id, result, evidence) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [e.actionHash, e.taskId, JSON.stringify(e.result ?? null), e.evidence],
    );
  }
}

const APPROVAL_SELECT = "SELECT id, task_id, action_hash, summary, status, (extract(epoch from expires_at)*1000)::float8 AS expires_ms, (extract(epoch from decided_at)*1000)::float8 AS decided_ms FROM approvals";

const toTask = (r: any): TaskRecord => ({ id: r.id, accountId: r.account_id, status: r.status });
const toApproval = (r: any): Approval => ({
  id: r.id, taskId: r.task_id, actionHash: r.action_hash, summary: r.summary, status: r.status,
  expiresAt: Math.round(r.expires_ms), ...(r.decided_ms != null ? { decidedAt: Math.round(r.decided_ms) } : {}),
});
