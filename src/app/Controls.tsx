"use client";
import { useState } from "react";

export function LoginForm() {
  const [err, setErr] = useState("");
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const token = String(new FormData(e.currentTarget).get("token"));
      const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ token }) });
      if (r.ok) location.reload(); else setErr(r.status === 429 ? "Too many attempts, wait a minute." : "Invalid credentials.");
    }}>
      <input name="token" type="password" placeholder="Owner access token" autoComplete="current-password" required style={{ padding: 8, width: "70%" }} />
      <button style={{ padding: 8, marginLeft: 8 }}>Sign in</button>
      {err && <p role="alert">{err}</p>}
    </form>
  );
}

export function DisconnectButton({ id }: { id: string }) {
  return <button onClick={async () => { if (confirm("Disconnect this mailbox?")) { await fetch(`/api/integrations?id=${id}`, { method: "DELETE" }); location.reload(); } }}>Disconnect</button>;
}
