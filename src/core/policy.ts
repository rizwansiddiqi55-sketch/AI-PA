import { ALWAYS_APPROVE, type ActionProposal, type Decision, type ToolDefinition, type UserSettings } from "./types";

/** Pure function: given a tool and the user's settings, what may happen? */
export function decide(tool: ToolDefinition, proposal: ActionProposal, settings: UserSettings): Decision {
  if (tool.effect === "read") return { kind: "allow", reason: "read-only tool" };

  if (settings.mode === "read_recommend") {
    return { kind: "deny", reason: "Mode A is read-and-recommend only; no external changes" };
  }

  const sensitive = tool.category && (ALWAYS_APPROVE as readonly string[]).includes(tool.category);
  if (sensitive) return { kind: "needs_approval", reason: `${tool.category} always requires explicit approval` };

  if (settings.mode === "execute_with_approval") {
    return { kind: "needs_approval", reason: "Mode B requires approval for every change" };
  }

  // Mode C: every condition must hold, otherwise fall back to approval.
  const d = tool.describe(proposal.input);
  if (!settings.autonomousTools.includes(tool.name)) {
    return { kind: "needs_approval", reason: "tool is not on the autonomous allowlist" };
  }
  if (tool.effect === "external" && (!d.recipient || !settings.trustedRecipients.includes(d.recipient))) {
    return { kind: "needs_approval", reason: "recipient is not on the trusted list" };
  }
  if ((d.amountMinor ?? 0) > settings.maxAmountMinor) {
    return { kind: "needs_approval", reason: "amount exceeds the configured spending limit" };
  }
  return { kind: "allow", reason: "within configured autonomous rules" };
}
