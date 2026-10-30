const BASE = "https://graph.microsoft.com/v1.0";
type Fetch = typeof fetch;

export interface OutlookMessage {
  id: string;
  conversationId: string;
  subject: string;
  from: string;
  replyTo: string[];
  to: string[];
  cc: string[];
  receivedAt: string;
  text: string;
}

const SELECT = "id,conversationId,subject,from,replyTo,toRecipients,ccRecipients,receivedDateTime,body";
const addr = (r: any): string => String(r?.emailAddress?.address ?? "").toLowerCase();
const addrs = (l: any[] | undefined) => (l ?? []).map(addr).filter(Boolean);
const q = (s: string) => s.replaceAll("'", "''");

/** Thin wrapper over Microsoft Graph mail (works for outlook.com / live.com / hotmail and work accounts). */
export class GraphMailClient {
  constructor(private getAccessToken: () => Promise<string>, private f: Fetch = fetch) {}

  private async call(path: string, init: RequestInit = {}, wantJson = true): Promise<any> {
    const res = await this.f(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.getAccessToken()}`, "Content-Type": "application/json", Prefer: 'outlook.body-content-type="text"', ...(init.headers as object) },
    });
    if (!res.ok) throw new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return wantJson && res.status !== 202 && res.status !== 204 ? res.json() : undefined;
  }

  async search(query: string, max = 10): Promise<{ id: string; conversationId: string; subject: string; preview: string }[]> {
    const term = query.replaceAll('"', "");
    const r = await this.call(`/me/messages?$search=${encodeURIComponent(`"${term}"`)}&$top=${max}&$select=id,conversationId,subject,bodyPreview`);
    return (r.value ?? []).map((m: any) => ({ id: m.id, conversationId: m.conversationId, subject: m.subject ?? "", preview: m.bodyPreview ?? "" }));
  }

  async getConversation(conversationId: string): Promise<OutlookMessage[]> {
    const r = await this.call(`/me/messages?$filter=${encodeURIComponent(`conversationId eq '${q(conversationId)}'`)}&$select=${SELECT}&$top=50`);
    const msgs: OutlookMessage[] = (r.value ?? []).map((m: any) => ({
      id: m.id, conversationId: m.conversationId, subject: m.subject ?? "", from: addr(m.from),
      replyTo: addrs(m.replyTo), to: addrs(m.toRecipients), cc: addrs(m.ccRecipients),
      receivedAt: m.receivedDateTime ?? "", text: m.body?.content ?? "",
    }));
    return msgs.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  }

  /** Creates a threaded reply draft (Graph quotes the original). Returns the draft id. */
  async createReplyDraft(messageId: string, comment: string): Promise<{ id: string }> {
    return this.call(`/me/messages/${encodeURIComponent(messageId)}/createReply`, { method: "POST", body: JSON.stringify({ comment }) });
  }

  async getMessage(id: string): Promise<{ id: string; isDraft: boolean }> {
    return this.call(`/me/messages/${encodeURIComponent(id)}?$select=id,isDraft`);
  }

  async reply(messageId: string, comment: string): Promise<void> {
    await this.call(`/me/messages/${encodeURIComponent(messageId)}/reply`, { method: "POST", body: JSON.stringify({ comment }) }, false);
  }

  async recentSent(top = 15): Promise<{ id: string; conversationId: string; sentAt: string; preview: string }[]> {
    const r = await this.call(`/me/mailFolders/sentitems/messages?$top=${top}&$orderby=${encodeURIComponent("sentDateTime desc")}&$select=id,conversationId,sentDateTime,bodyPreview`);
    return (r.value ?? []).map((m: any) => ({ id: m.id, conversationId: m.conversationId, sentAt: m.sentDateTime ?? "", preview: m.bodyPreview ?? "" }));
  }
}
