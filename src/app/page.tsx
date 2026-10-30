import { cookies } from "next/headers";
import { sessions, vault } from "@/lib/server";
import { DisconnectButton, LoginForm } from "./Controls";

export const dynamic = "force-dynamic";

const MODES = [
  ["A", "Read and recommend", "Reads, researches, drafts. Makes no external changes."],
  ["B", "Execute with approval", "Prepares each action and waits for your approval. Default."],
  ["C", "Limited autonomous", "Runs only allowlisted low-risk actions. Purchases always need approval."],
];
const LABEL = { google: "Gmail", microsoft: "Outlook / live.com" } as const;

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  let accountId: string | undefined;
  let rows: Awaited<ReturnType<ReturnType<typeof vault>["list"]>> = [];
  let setupError = "";
  try {
    const token = (await cookies()).get("session")?.value;
    accountId = token ? await sessions().verify(token) : undefined;
    if (accountId) rows = await vault().list(accountId);
  } catch { setupError = "Server not configured (DATABASE_URL / TOKEN_ENCRYPTION_KEY). See .env.example."; }

  return (
    <main>
      <h1>AI-PA</h1>
      {setupError && <p role="alert">{setupError}</p>}
      {!accountId ? <LoginForm /> : (
        <>
          {sp.connected && <p>Connected {sp.connected}.</p>}
          {sp.error && <p role="alert">Could not connect: {sp.error}</p>}
          <h2>Mailboxes</h2>
          {rows.length === 0 && <p>None connected.</p>}
          <ul>{rows.map((r) => (
            <li key={r.id}>{LABEL[r.provider]}: {r.externalId} ({r.status}) <DisconnectButton id={r.id} /></li>
          ))}</ul>
          <p><a href="/api/connect/google">Connect Gmail</a> · <a href="/api/connect/microsoft">Connect Outlook / live.com</a></p>
        </>
      )}
      <h2>Operating modes</h2>
      <ul>{MODES.map(([k, n, d]) => <li key={k}><b>Mode {k}: {n}.</b> {d}</li>)}</ul>
    </main>
  );
}
