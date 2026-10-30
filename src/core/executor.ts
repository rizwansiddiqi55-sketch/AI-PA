import { randomUUID } from "node:crypto";
import { actionHash } from "./approval";
import { AuditLog } from "./audit";
import { decide } from "./policy";
import type { Store } from "./store";
import type { ActionProposal, ToolDefinition, UserSettings } from "./types";

export type ExecOutcome =
  | { status: "completed"; result: unknown; evidence: string; duplicate?: boolean }
  | { status: "awaiting_approval"; approvalId: string; summary: string }
  | { status: "denied"; reason: string }
  | { status: "cancelled" }
  | { status: "failed"; error: string; unverified?: boolean };

const APPROVAL_TTL_MS = 15 * 60_000;

export class Executor {
  private tools = new Map<string, ToolDefinition>();

  constructor(
    private store: Store,
    private audit: AuditLog,
    private getSettings: (accountId: string) => UserSettings,
    private now: () => number = Date.now,
  ) {}

  register(tool: ToolDefinition) {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  async execute(p: ActionProposal): Promise<ExecOutcome> {
    const tool = this.tools.get(p.tool);
    if (!tool) return { status: "denied", reason: `unknown tool ${p.tool}` };

    const task = await this.store.getTask(p.taskId);
    if (!task || task.accountId !== p.accountId) return { status: "denied", reason: "task not found for this account" };
    if (task.status === "cancelled") return { status: "cancelled" };

    const parsed = tool.input.safeParse(p.input);
    if (!parsed.success) return { status: "failed", error: `invalid input: ${parsed.error.message}` };
    const input = parsed.data;

    const hash = actionHash(tool, p.accountId, input);

    // Duplicate-action prevention: an identical, already-verified action is never run twice.
    const prior = await this.store.getExecution(hash);
    if (prior) {
      this.audit.append(p.accountId, p.taskId, "duplicate_suppressed", { tool: tool.name, hash });
      return { status: "completed", result: prior.result, evidence: prior.evidence, duplicate: true };
    }

    const decision = decide(tool, { ...p, input }, this.getSettings(p.accountId));
    if (decision.kind === "deny") {
      this.audit.append(p.accountId, p.taskId, "denied", { tool: tool.name, reason: decision.reason });
      return { status: "denied", reason: decision.reason };
    }

    if (decision.kind === "needs_approval") {
      const existing = await this.store.findApproval(p.taskId, hash);
      if (existing?.status === "approved" && existing.expiresAt > this.now() && (await this.store.consumeApproval(existing.id))) {
        this.audit.append(p.accountId, p.taskId, "approval_consumed", { approvalId: existing.id, hash });
      } else if (existing?.status === "pending" && existing.expiresAt > this.now()) {
        return { status: "awaiting_approval", approvalId: existing.id, summary: existing.summary };
      } else {
        const summary = tool.describe(input).summary;
        const approval = { id: randomUUID(), taskId: p.taskId, actionHash: hash, summary, status: "pending" as const, expiresAt: this.now() + APPROVAL_TTL_MS };
        await this.store.saveApproval(approval);
        await this.store.setTaskStatus(p.taskId, "awaiting_approval");
        this.audit.append(p.accountId, p.taskId, "approval_requested", { approvalId: approval.id, hash, reason: decision.reason });
        return { status: "awaiting_approval", approvalId: approval.id, summary };
      }
    }

    // Re-check cancellation immediately before the side effect.
    if ((await this.store.getTask(p.taskId))?.status === "cancelled") return { status: "cancelled" };

    await this.store.setTaskStatus(p.taskId, "running");
    this.audit.append(p.accountId, p.taskId, "executing", { tool: tool.name, hash, via: decision.kind });
    try {
      const result = await tool.run(input, { accountId: p.accountId, taskId: p.taskId });
      if (!tool.verify) {
        // No authoritative check available: report honestly rather than claim success.
        this.audit.append(p.accountId, p.taskId, "unverified", { tool: tool.name, hash });
        return { status: "failed", error: "action ran but cannot be verified", unverified: true };
      }
      const v = await tool.verify(input, result);
      if (!v.ok) {
        this.audit.append(p.accountId, p.taskId, "verification_failed", { tool: tool.name, hash, evidence: v.evidence });
        await this.store.setTaskStatus(p.taskId, "failed");
        return { status: "failed", error: `verification failed: ${v.evidence}` };
      }
      await this.store.saveExecution({ actionHash: hash, taskId: p.taskId, result, evidence: v.evidence });
      await this.store.setTaskStatus(p.taskId, "completed");
      this.audit.append(p.accountId, p.taskId, "verified", { tool: tool.name, hash, evidence: v.evidence });
      return { status: "completed", result, evidence: v.evidence };
    } catch (e) {
      await this.store.setTaskStatus(p.taskId, "failed");
      this.audit.append(p.accountId, p.taskId, "error", { tool: tool.name, message: String(e) });
      return { status: "failed", error: String(e) };
    }
  }

  /** Called from the UI. Only an authenticated user decision may reach this. */
  async decideApproval(accountId: string, taskId: string, approvalId: string, approve: boolean) {
    const task = await this.store.getTask(taskId);
    if (!task || task.accountId !== accountId) throw new Error("not found");
    const a = await this.store.getApproval(approvalId);
    if (!a || a.taskId !== taskId || a.status !== "pending") throw new Error("approval not pending");
    a.status = approve ? "approved" : "rejected";
    a.decidedAt = this.now();
    await this.store.saveApproval(a);
    this.audit.append(accountId, taskId, approve ? "approved" : "rejected", { approvalId });
  }

  async cancelTask(accountId: string, taskId: string) {
    const task = await this.store.getTask(taskId);
    if (!task || task.accountId !== accountId) throw new Error("not found");
    await this.store.setTaskStatus(taskId, "cancelled");
    this.audit.append(accountId, taskId, "cancelled");
  }
}
