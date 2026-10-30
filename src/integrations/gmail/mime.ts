export interface Header { name: string; value: string }

const hdr = (headers: Header[], name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
export { hdr as header };

/** CR/LF in a header value would let content inject extra headers (e.g. Bcc). */
export function safeHeader(value: string, field: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`illegal line break in ${field}`);
  return value;
}

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

export function replySubject(original: string): string {
  return /^re:/i.test(original.trim()) ? original.trim() : `Re: ${original.trim()}`;
}

/** Builds an RFC 5322 reply that Gmail threads correctly (In-Reply-To + References + threadId). */
export function buildReplyRaw(o: { to: string; subject: string; body: string; inReplyTo: string; references?: string }): string {
  const refs = [o.references, o.inReplyTo].filter(Boolean).join(" ");
  const lines = [
    `To: ${safeHeader(o.to, "To")}`,
    `Subject: ${encodeWord(safeHeader(replySubject(o.subject), "Subject"))}`,
    `In-Reply-To: ${safeHeader(o.inReplyTo, "In-Reply-To")}`,
    `References: ${safeHeader(refs, "References")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(o.body, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export function addresses(field: string | undefined): string[] {
  if (!field) return [];
  return [...field.matchAll(/[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0].toLowerCase());
}
