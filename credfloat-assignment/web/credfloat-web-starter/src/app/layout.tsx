import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

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
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface text-ink antialiased">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" closeButton richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
