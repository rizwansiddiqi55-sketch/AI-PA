import { completeConnect, type PendingAuth } from "@/integrations/oauth/connect";
import { isProvider } from "@/integrations/oauth/providers";
import { accountFromRequest, appUrl, cookieFlags, cookieValue, vault } from "@/lib/server";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return new Response("unknown provider", { status: 404 });
  const accountId = await accountFromRequest(req);
  if (!accountId) return new Response("sign in first", { status: 401 });

  const q = new URL(req.url).searchParams;
  const done = (msg: string) => new Response(null, {
    status: 302,
    headers: { Location: `${appUrl()}/?${msg}`, "Set-Cookie": `oauth_${provider}=; Max-Age=0; ${cookieFlags()}` },
  });
  if (q.get("error")) return done(`error=${encodeURIComponent(q.get("error")!)}`);
  const code = q.get("code");
  if (!code) return done("error=missing_code");

  let pending: PendingAuth | undefined;
  try { pending = JSON.parse(cookieValue(req, `oauth_${provider}`) ?? "null"); } catch { /* treated as invalid state */ }
  try {
    const r = await completeConnect(vault(), { accountId, provider, redirectUri: `${appUrl()}/api/oauth/callback/${provider}`, code, returnedState: q.get("state") ?? undefined, pending });
    return done(`connected=${encodeURIComponent(r.email)}`);
  } catch (e) {
    console.error("oauth callback failed", provider, (e as Error).message); // never log tokens or codes
    return done("error=connect_failed");
  }
}
