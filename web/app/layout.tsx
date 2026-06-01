import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Judge Me Bro",
  description: "Local-first AI hackathon judging — score ideas, meta-judge the judges, rank reputation.",
};

/**
 * Root layout. The dark theme lives on <body> via the ported design tokens in
 * globals.css; we set color-scheme: dark so native UI (scrollbars, form
 * controls) matches the panel palette.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
