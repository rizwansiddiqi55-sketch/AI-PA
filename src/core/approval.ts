import { createHash } from "node:crypto";
import type { ToolDefinition } from "./types";

/** Deterministic JSON: sorted keys, so equal inputs always hash equally. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/**
 * Binds an approval to the exact action: account, tool, full input, recipient, amount, currency.
 * Change any of them and the hash changes, so the old approval no longer applies.
 */
export function actionHash(tool: ToolDefinition, accountId: string, input: unknown): string {
  const d = tool.describe(input);
  const material = canonicalize({
    accountId,
    tool: tool.name,
    input,
    recipient: d.recipient ?? null,
    amountMinor: d.amountMinor ?? null,
    currency: d.currency ?? null,
  });
  return createHash("sha256").update(material).digest("hex");
}
