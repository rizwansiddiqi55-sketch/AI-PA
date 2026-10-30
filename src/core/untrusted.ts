/**
 * Emails, WhatsApp messages, web pages and uploaded files are data, never instructions.
 * Wrapping makes the boundary explicit to the model; flagging surfaces likely injection to the user.
 * Neither grants any authority: permissions come only from policy.ts and approvals.
 */
const PATTERNS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /disregard .{0,40}(instructions|permissions|rules)/i,
  /you (are|must) now (act|behave)/i,
  /(send|forward|reveal|share).{0,40}(password|token|api key|secret|credentials)/i,
  /(approve|authori[sz]e) (this|the) (payment|purchase|transfer) on (my|the user'?s) behalf/i,
];

export function flagInjection(text: string): string[] {
  return PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

export function wrapUntrusted(source: string, text: string): string {
  const safe = text.replaceAll("</untrusted>", "&lt;/untrusted&gt;");
  return `<untrusted source="${source}">\n${safe}\n</untrusted>`;
}
