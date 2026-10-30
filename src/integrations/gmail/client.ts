import { addresses, header, type Header } from "./mime";

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  from: string;
  to: string[];
  cc: string[];
  replyTo?: string;
  subject: string;
  messageId: string;
  references?: string;
  date?: string;
  text: string;
}
export interface GmailThread { id: string; messages: GmailMessage[] }

type Fetch = typeof fetch;

/** Thin wrapper over the official Gmail REST API. Token supply and fetch are injected. */
export class GmailClient {
  constructor(private getAccessToken: () => Promise<string>, private f: Fetch = fetch) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.f(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.getAccessToken()}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async searchThreads(q: string, max = 10): Promise<{ id: string; snippet: string }[]> {
    const r = await this.call<{ threads?: { id: string; snippet: string }[] }>(`/threads?q=${encodeURIComponent(q)}&maxResults=${max}`);
    return r.threads ?? [];
  }

  async getThread(id: string): Promise<GmailThread> {
    const r = await this.call<{ id: string; messages: any[] }>(`/threads/${encodeURIComponent(id)}?format=full`);
    return { id: r.id, messages: (r.messages ?? []).map(parseMessage) };
  }

  async createDraft(threadId: string, raw: string): Promise<{ id: string }> {
    return this.call(`/drafts`, { method: "POST", body: JSON.stringify({ message: { raw, threadId } }) });
  }

  async send(threadId: string, raw: string): Promise<{ id: string; threadId: string }> {
    return this.call(`/messages/send`, { method: "POST", body: JSON.stringify({ raw, threadId }) });
  }

  async getMessageMeta(id: string): Promise<{ id: string; threadId: string; labelIds: string[] }> {
    return this.call(`/messages/${encodeURIComponent(id)}?format=minimal`);
  }
}

function parseMessage(m: any): GmailMessage {
  const h: Header[] = m.payload?.headers ?? [];
  return {
    id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? [],
    from: header(h, "From") ?? "", to: addresses(header(h, "To")), cc: addresses(header(h, "Cc")),
    ...(header(h, "Reply-To") ? { replyTo: header(h, "Reply-To")! } : {}),
    subject: header(h, "Subject") ?? "", messageId: header(h, "Message-ID") ?? header(h, "Message-Id") ?? "",
    ...(header(h, "References") ? { references: header(h, "References")! } : {}),
    ...(header(h, "Date") ? { date: header(h, "Date")! } : {}),
    text: extractText(m.payload),
  };
}

function extractText(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts ?? []) {
    const t = extractText(p);
    if (t) return t;
  }
  return "";
}
