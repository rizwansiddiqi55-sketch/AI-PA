const MODES = [
  ["A", "Read and recommend", "Reads, researches, drafts. Makes no external changes."],
  ["B", "Execute with approval", "Prepares each action and waits for your approval. Default."],
  ["C", "Limited autonomous", "Runs only allowlisted low-risk actions. Purchases always need approval."],
];

// Phase 1 shell. No integration is connected yet; nothing here is simulated data.
export default function Home() {
  return (
    <main>
      <h1>AI-PA</h1>
      <p>Foundation phase. Policy and approval engine implemented; integrations not connected.</p>
      <h2>Operating modes</h2>
      <ul>{MODES.map(([k, n, d]) => <li key={k}><b>Mode {k}: {n}.</b> {d}</li>)}</ul>
      <h2>Integrations</h2>
      <p>None connected. Gmail and Calendar are next (Phase 2/3).</p>
    </main>
  );
}
