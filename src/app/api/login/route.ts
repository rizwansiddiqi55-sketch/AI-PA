import { db, cookieFlags, rateLimited, SESSION_COOKIE, secretMatches, sameOrigin, sessions } from "@/lib/server";

// Single-owner sign-in: OWNER_EMAIL identifies the account; ADMIN_BOOTSTRAP_TOKEN (24+ chars) proves it's you.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(`login:${ip}`)) return new Response("too many attempts", { status: 429 });
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const owner = process.env.OWNER_EMAIL?.toLowerCase();
  if (!owner || !token || !secretMatches(token, process.env.ADMIN_BOOTSTRAP_TOKEN)) return new Response("invalid credentials", { status: 401 });
  const r = await db().query("INSERT INTO accounts(email) VALUES ($1) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id", [owner]);
  const session = await sessions().create(r.rows[0].id, req.headers.get("user-agent") ?? undefined);
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=${session}; Max-Age=43200; ${cookieFlags()}` } });
}
