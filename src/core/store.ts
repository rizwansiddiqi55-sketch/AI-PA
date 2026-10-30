import type { Approval, TaskStatus } from "./types";

export interface TaskRecord {
  id: string;
  accountId: string;
  status: TaskStatus;
}

export interface ExecutionRecord {
  actionHash: string;
  taskId: string;
  result: unknown;
  evidence: string;
}

/** Persistence port. The Postgres implementation lives behind this; see db/migrations. */
export interface Store {
  getTask(id: string): Promise<TaskRecord | undefined>;
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  saveApproval(a: Approval): Promise<void>;
  getApproval(id: string): Promise<Approval | undefined>;
  findApproval(taskId: string, actionHash: string): Promise<Approval | undefined>;
  /** Atomically flips approved -> consumed. Returns false if it was not approved (or already used). */
  consumeApproval(id: string): Promise<boolean>;
  getExecution(actionHash: string): Promise<ExecutionRecord | undefined>;
  saveExecution(r: ExecutionRecord): Promise<void>;
}

/** TEST/DEV ONLY. Not durable; never use in production. */
export class InMemoryStore implements Store {
  tasks = new Map<string, TaskRecord>();
  approvals = new Map<string, Approval>();
  executions = new Map<string, ExecutionRecord>();

  async getTask(id: string) { return this.tasks.get(id); }
  async setTaskStatus(id: string, status: TaskStatus) {
    const t = this.tasks.get(id);
    if (t) t.status = status;
  }
  async saveApproval(a: Approval) { this.approvals.set(a.id, a); }
  async getApproval(id: string) { return this.approvals.get(id); }
  async findApproval(taskId: string, actionHash: string) {
    return [...this.approvals.values()].find((a) => a.taskId === taskId && a.actionHash === actionHash && a.status !== "consumed" && a.status !== "rejected");
  }
  async consumeApproval(id: string) {
    const a = this.approvals.get(id);
    if (!a || a.status !== "approved") return false;
    a.status = "consumed";
    return true;
  }
  async getExecution(h: string) { return this.executions.get(h); }
  async saveExecution(r: ExecutionRecord) { this.executions.set(r.actionHash, r); }
}
