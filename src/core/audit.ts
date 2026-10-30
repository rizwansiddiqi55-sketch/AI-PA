import { createHash } from "node:crypto";
import type { AuditEntry } from "./types";

const GENESIS = "0".repeat(64);

/** Append-only log; each entry commits to the previous one so edits or deletions are detectable. */
export class AuditLog {
  private entries: AuditEntry[] = [];

  append(accountId: string, taskId: string, event: string, detail: Record<string, unknown> = {}, now = Date.now()): AuditEntry {
    const prev = this.entries.at(-1);
    const seq = (prev?.seq ?? 0) + 1;
    const prevHash = prev?.hash ?? GENESIS;
    const hash = AuditLog.hashOf({ seq, at: now, accountId, taskId, event, detail, prevHash });
    const entry: AuditEntry = { seq, at: now, accountId, taskId, event, detail, prevHash, hash };
    this.entries.push(entry);
    return entry;
  }

  list(taskId?: string): readonly AuditEntry[] {
    return taskId ? this.entries.filter((e) => e.taskId === taskId) : this.entries;
  }

  verifyChain(entries: readonly AuditEntry[] = this.entries): boolean {
    let prevHash = GENESIS;
    for (const e of entries) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prevHash || AuditLog.hashOf(rest) !== hash) return false;
      prevHash = hash;
    }
    return true;
  }

  private static hashOf(v: Omit<AuditEntry, "hash">): string {
    return createHash("sha256").update(JSON.stringify(v)).digest("hex");
  }
}
