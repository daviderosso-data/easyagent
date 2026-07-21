import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "easyagent",
  description: "Your coding agents in one simple interface.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
