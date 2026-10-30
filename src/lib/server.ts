import { timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { TokenVault } from "../integrations/oauth/vault";
import { loadKey } from "../security/crypto";
import { Sessions } from "../security/sessions";

export const SESSION_COOKIE = "session";

let pool: Pool | undefined;
export const db = () => (pool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
export const sessions = () => new Sessions(db());
export const vault = () => new TokenVault(db(), loadKey());
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function cookieValue(req: Request, name: string): string | undefined {
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
}

export async function accountFromRequest(req: Request): Promise<string | undefined> {
  const t = cookieValue(req, SESSION_COOKIE);
  return t ? sessions().verify(t) : undefined;
}

/** Constant-time compare for the single-owner bootstrap secret. */
export function secretMatches(given: string, expected: string | undefined): boolean {
  if (!expected || expected.length < 24) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** In-memory fixed-window limiter (per process). Enough for a single-user deployment. */
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, max = 5, windowMs = 60_000, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  return ++h.n > max;
}

/** Reject cross-site state-changing requests. */
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin");
  return !o || o === appUrl();
}

export const cookieFlags = () => `Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
