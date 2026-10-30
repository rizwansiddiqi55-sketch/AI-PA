import { startConnect } from "@/integrations/oauth/connect";
import { isProvider } from "@/integrations/oauth/providers";
import { accountFromRequest, appUrl, cookieFlags } from "@/lib/server";

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) return new Response("unknown provider", { status: 404 });
  if (!(await accountFromRequest(req))) return new Response("sign in first", { status: 401 });
  const { url, pending } = startConnect(provider, `${appUrl()}/api/oauth/callback/${provider}`);
  const cookie = encodeURIComponent(JSON.stringify(pending));
  return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": `oauth_${provider}=${cookie}; Max-Age=600; ${cookieFlags()}` } });
}
