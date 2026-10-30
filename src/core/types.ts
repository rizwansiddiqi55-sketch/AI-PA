import type { ZodTypeAny } from "zod";

/** MODE A / B / C from the product spec. */
export type OperatingMode = "read_recommend" | "execute_with_approval" | "limited_autonomous";

export type Effect = "read" | "write" | "external";

/** Categories that can never run without a fresh, exactly-bound approval. */
export const ALWAYS_APPROVE = [
  "payment",
  "booking",
  "sensitive_data",
  "account_change",
  "legal_financial",
  "obligation",
] as const;
export type SensitiveCategory = (typeof ALWAYS_APPROVE)[number];

export interface ToolDefinition<I = unknown, R = unknown> {
  name: string;
  description: string;
  /** read = no side effects; write = changes our own data; external = affects the outside world. */
  effect: Effect;
  category?: SensitiveCategory | "routine";
  input: ZodTypeAny;
  /** Pull out the fields that approvals are bound to. */
  describe(input: I): { recipient?: string; amountMinor?: number; currency?: string; summary: string };
  run(input: I, ctx: { accountId: string; taskId: string }): Promise<R>;
  /** Re-reads authoritative state. Success is reported only if this returns ok with evidence. */
  verify?(input: I, result: R): Promise<{ ok: boolean; evidence: string }>;
}

export interface ActionProposal {
  taskId: string;
  accountId: string;
  tool: string;
  input: unknown;
}

export interface UserSettings {
  mode: OperatingMode;
  /** Mode C only. Tools the user explicitly allowed to run autonomously. */
  autonomousTools: string[];
  /** Mode C only. Recipients allowed for autonomous external actions. */
  trustedRecipients: string[];
  /** Mode C only. Per-action spend ceiling in minor units; 0 means no spending. */
  maxAmountMinor: number;
}

export type Decision =
  | { kind: "allow"; reason: string }
  | { kind: "needs_approval"; reason: string }
  | { kind: "deny"; reason: string };

export type TaskStatus =
  | "planned"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface Approval {
  id: string;
  taskId: string;
  actionHash: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "consumed";
  expiresAt: number;
  decidedAt?: number;
}

export interface AuditEntry {
  seq: number;
  at: number;
  accountId: string;
  taskId: string;
  event: string;
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
}
