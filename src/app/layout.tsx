export const metadata = { title: "AI-PA", description: "Personal AI agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui", margin: 0, padding: 16, maxWidth: 720 }}>{children}</body>
    </html>
  );
}
