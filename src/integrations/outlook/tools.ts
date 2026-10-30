import { z } from "zod";
import type { ToolDefinition } from "../../core/types";
import { flagInjection, wrapUntrusted } from "../../core/untrusted";
import { GraphMailClient } from "./client";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Outlook / live.com tools for one connected mailbox. `ownAddress` is the authenticated account. */
export function outlookTools(graph: GraphMailClient, ownAddress: string, wait: (ms: number) => Promise<void> = sleep): ToolDefinition<any, any>[] {
  const own = ownAddress.toLowerCase();

  const search: ToolDefinition<{ query: string; max?: number }, any[]> = {
    name: "outlook.search", description: "Search Outlook mail", effect: "read",
    input: z.object({ query: z.string().min(1).max(500), max: z.number().int().min(1).max(25).optional() }),
    describe: (i) => ({ summary: `Search Outlook: ${i.query}` }),
    run: (i) => graph.search(i.query, i.max),
    verify: async (_i, r) => ({ ok: Array.isArray(r), evidence: `${r.length} message(s)` }),
  };

  const readThread: ToolDefinition<{ conversationId: string }, { wrapped: string; injectionFlags: string[] }> = {
    name: "outlook.read_thread", description: "Read a conversation; text is returned as untrusted content", effect: "read",
    input: z.object({ conversationId: z.string().min(1) }),
    describe: (i) => ({ summary: `Read conversation ${i.conversationId.slice(0, 12)}…` }),
    run: async (i) => {
      const msgs = await graph.getConversation(i.conversationId);
      const text = msgs.map((m) => `From: ${m.from}\nSubject: ${m.subject}\n\n${m.text}`).join("\n---\n");
      return { wrapped: wrapUntrusted("outlook", text), injectionFlags: flagInjection(text) };
    },
    verify: async (_i, r) => ({ ok: r.wrapped.length > 0, evidence: `read ${r.wrapped.length} chars` }),
  };

  const replyInput = z.object({ conversationId: z.string().min(1), to: z.string().email(), body: z.string().min(1).max(20000) });
  type ReplyIn = z.infer<typeof replyInput>;

  /** The reply goes to the last message's Reply-To/From. It must equal the approved `to`, and not be us. */
  async function target(i: ReplyIn) {
    const msgs = await graph.getConversation(i.conversationId);
    const last = msgs.at(-1);
    if (!last) throw new Error("conversation is empty");
    if (last.from === own) throw new Error("last message is from you; nothing to reply to");
    const dest = last.replyTo[0] ?? last.from;
    if (dest !== i.to.toLowerCase()) throw new Error("recipient does not match who this conversation would reply to");
    return last;
  }

  const draftReply: ToolDefinition<ReplyIn, { draftId: string }> = {
    name: "outlook.draft_reply", description: "Create a threaded reply draft in Outlook (does not send)", effect: "write",
    input: replyInput,
    describe: (i) => ({ recipient: i.to, summary: `Draft reply to ${i.to}` }),
    run: async (i) => { const last = await target(i); return { draftId: (await graph.createReplyDraft(last.id, i.body)).id }; },
    verify: async (_i, r) => { const m = await graph.getMessage(r.draftId); return { ok: m.isDraft, evidence: `Outlook draft ${m.id} isDraft=${m.isDraft}` }; },
  };

  const sendReply: ToolDefinition<ReplyIn, { conversationId: string; sentAfter: string }> = {
    name: "outlook.send_reply", description: "Send a reply inside an existing Outlook conversation", effect: "external",
    input: replyInput,
    describe: (i) => ({ recipient: i.to, summary: `Send reply to ${i.to}: "${i.body.slice(0, 120)}"` }),
    run: async (i) => {
      const last = await target(i);
      const sentAfter = new Date(Date.now() - 2000).toISOString(); // small allowance for clock skew
      await graph.reply(last.id, i.body); // Graph returns 202 with no id, so verify() must find it in Sent Items
      return { conversationId: i.conversationId, sentAfter };
    },
    verify: async (i, r) => {
      const needle = i.body.trim().slice(0, 40);
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await wait(1500);
        const hit = (await graph.recentSent()).find((m) => m.conversationId === r.conversationId && m.sentAt >= r.sentAfter && m.preview.includes(needle));
        if (hit) return { ok: true, evidence: `found in Sent Items: ${hit.id} at ${hit.sentAt}` };
      }
      return { ok: false, evidence: "no matching message in Sent Items after sending" };
    },
  };

  return [search, readThread, draftReply, sendReply];
}
