import { accountFromRequest, sameOrigin, vault } from "@/lib/server";

export async function GET(req: Request) {
  const accountId = await accountFromRequest(req);
  if (!accountId) return new Response("unauthorized", { status: 401 });
  return Response.json(await vault().list(accountId));
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return new Response("forbidden", { status: 403 });
  const accountId = await accountFromRequest(req);
  if (!accountId) return new Response("unauthorized", { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new Response("missing id", { status: 400 });
  try { await vault().disconnect(accountId, id); } catch { return new Response("not found", { status: 404 }); }
  return new Response(null, { status: 204 });
}
