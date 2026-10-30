import { z } from "zod";
import type { ToolDefinition } from "../../core/types";
import { wrapUntrusted, flagInjection } from "../../core/untrusted";
import { GmailClient } from "./client";
import { addresses, buildReplyRaw } from "./mime";

type Ctx = { accountId: string; taskId: string };

/** Builds Gmail tools for one connected mailbox. `ownAddress` is the authenticated Gmail account. */
export function gmailTools(gmail: GmailClient, ownAddress: string): ToolDefinition<any, any>[] {
  const own = ownAddress.toLowerCase();

  const search: ToolDefinition<{ query: string; max?: number }, { id: string; snippet: string }[]> = {
    name: "gmail.search", description: "Search Gmail threads", effect: "read",
    input: z.object({ query: z.string().min(1).max(500), max: z.number().int().min(1).max(25).optional() }),
    describe: (i) => ({ summary: `Search Gmail: ${i.query}` }),
    run: (i) => gmail.searchThreads(i.query, i.max),
    verify: async (_i, r) => ({ ok: Array.isArray(r), evidence: `${r.length} thread(s)` }),
  };

  const readThread: ToolDefinition<{ threadId: string }, { wrapped: string; injectionFlags: string[] }> = {
    name: "gmail.read_thread", description: "Read a thread; body text is returned as untrusted content", effect: "read",
    input: z.object({ threadId: z.string().min(1) }),
    describe: (i) => ({ summary: `Read thread ${i.threadId}` }),
    run: async (i) => {
      const t = await gmail.getThread(i.threadId);
      const text = t.messages.map((m) => `From: ${m.from}\nSubject: ${m.subject}\n\n${m.text}`).join("\n---\n");
      return { wrapped: wrapUntrusted("gmail", text), injectionFlags: flagInjection(text) };
    },
    verify: async (_i, r) => ({ ok: r.wrapped.length > 0, evidence: `read ${r.wrapped.length} chars` }),
  };

  const replyInput = z.object({ threadId: z.string().min(1), to: z.string().email(), body: z.string().min(1).max(20000) });
  type ReplyIn = z.infer<typeof replyInput>;

  /** Resolves the thread and checks `to` is already a participant, so injected text cannot redirect a reply. */
  async function prepare(i: ReplyIn) {
    const t = await gmail.getThread(i.threadId);
    const last = t.messages.at(-1);
    if (!last) throw new Error("thread is empty");
    const people = new Set(t.messages.flatMap((m) => [...addresses(m.from), ...m.to, ...m.cc, ...addresses(m.replyTo)]));
    if (!people.has(i.to.toLowerCase()) || i.to.toLowerCase() === own) throw new Error("recipient is not another participant of this thread");
    if (!last.messageId) throw new Error("last message has no Message-ID; cannot thread reply");
    const raw = buildReplyRaw({ to: i.to, subject: last.subject, body: i.body, inReplyTo: last.messageId, ...(last.references ? { references: last.references } : {}) });
    return { raw, threadId: t.id };
  }

  const draftReply: ToolDefinition<ReplyIn, { draftId: string }> = {
    name: "gmail.draft_reply", description: "Create a Gmail draft reply inside an existing thread (does not send)", effect: "write",
    input: replyInput,
    describe: (i) => ({ recipient: i.to, summary: `Draft reply to ${i.to} in thread ${i.threadId}` }),
    run: async (i, _c: Ctx) => { const p = await prepare(i); return { draftId: (await gmail.createDraft(p.threadId, p.raw)).id }; },
    verify: async (_i, r) => ({ ok: !!r.draftId, evidence: `Gmail created draft ${r.draftId}` }),
  };

  const sendReply: ToolDefinition<ReplyIn, { messageId: string; threadId: string }> = {
    name: "gmail.send_reply", description: "Send a reply inside an existing thread", effect: "external",
    input: replyInput,
    describe: (i) => ({ recipient: i.to, summary: `Send reply to ${i.to} in thread ${i.threadId}: "${i.body.slice(0, 120)}"` }),
    run: async (i) => { const p = await prepare(i); const r = await gmail.send(p.threadId, p.raw); return { messageId: r.id, threadId: r.threadId }; },
    // Authoritative check: re-read the sent message and confirm it is in SENT and in the same thread.
    verify: async (i, r) => {
      const m = await gmail.getMessageMeta(r.messageId);
      const ok = m.labelIds.includes("SENT") && m.threadId === i.threadId;
      return { ok, evidence: `message ${m.id} labels=${m.labelIds.join(",")} thread=${m.threadId}` };
    },
  };

  return [search, readThread, draftReply, sendReply];
}
