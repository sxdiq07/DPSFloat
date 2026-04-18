import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CredFloat — DPS & Co",
  description: "Internal collection engine for DPS & Co",
};

export const viewport = {
  themeColor: "#fbfbfd",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
