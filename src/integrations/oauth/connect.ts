import { buildAuthUrl, exchangeCode, fetchIdentity, newPkce, statesMatch } from "./oauth";
import { clientCreds, providerConfig, type ProviderId } from "./providers";
import type { TokenVault } from "./vault";

export interface PendingAuth { state: string; verifier: string }

export function startConnect(provider: ProviderId, redirectUri: string): { url: string; pending: PendingAuth } {
  const { clientId } = clientCreds(provider);
  const p = newPkce();
  return { url: buildAuthUrl(providerConfig(provider), { clientId, redirectUri, state: p.state, challenge: p.challenge }), pending: { state: p.state, verifier: p.verifier } };
}

/** Validates state (CSRF), exchanges the code, identifies the mailbox and stores encrypted tokens. */
export async function completeConnect(
  vault: TokenVault,
  a: { accountId: string; provider: ProviderId; redirectUri: string; code: string; returnedState: string | undefined; pending: PendingAuth | undefined },
  f: typeof fetch = fetch,
): Promise<{ integrationId: string; email: string }> {
  if (!a.pending || !statesMatch(a.pending.state, a.returnedState)) throw new Error("invalid OAuth state");
  const cfg = providerConfig(a.provider);
  const tokens = await exchangeCode(cfg, { ...clientCreds(a.provider), redirectUri: a.redirectUri, code: a.code, verifier: a.pending.verifier }, f);
  if (!tokens.refreshToken) throw new Error("provider did not return a refresh token; remove the app's access in your account and retry");
  const email = await fetchIdentity(cfg, tokens.accessToken, f);
  const integrationId = await vault.save(a.accountId, a.provider, email, cfg.scopes, tokens);
  return { integrationId, email };
}
