export type ProviderId = "google" | "microsoft";

export interface ProviderConfig {
  id: ProviderId;
  authUrl: string;
  tokenUrl: string;
  identityUrl: string;
  /** Least privilege for the mail features implemented so far. */
  scopes: string[];
  extraAuthParams: Record<string, string>;
  revokeUrl?: string;
}

export function providerConfig(id: ProviderId, env: Record<string, string | undefined> = process.env): ProviderConfig {
  if (id === "google") {
    return {
      id,
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      identityUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"],
      // offline + consent are what make Google return a refresh token.
      extraAuthParams: { access_type: "offline", prompt: "consent" },
    };
  }
  // "common" accepts personal accounts (outlook.com / live.com / hotmail) and work accounts.
  const tenant = env.MICROSOFT_TENANT || "common";
  return {
    id,
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    identityUrl: "https://graph.microsoft.com/v1.0/me",
    scopes: ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"],
    extraAuthParams: { response_mode: "query", prompt: "select_account" },
  };
}

export function isProvider(s: string): s is ProviderId {
  return s === "google" || s === "microsoft";
}

export function clientCreds(id: ProviderId, env: Record<string, string | undefined> = process.env) {
  const [idKey, secretKey] = id === "google" ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] : ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"];
  const clientId = env[idKey], clientSecret = env[secretKey];
  if (!clientId || !clientSecret) throw new Error(`${idKey} and ${secretKey} must be set`);
  return { clientId, clientSecret };
}
