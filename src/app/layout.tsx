import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mezbaan · the smart host stand",
  description:
    "Live floor, no double booking, a waiting list guests join from their phone, and no-show protection for restaurants.",
};

export const viewport: Viewport = { themeColor: "#13296e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-background text-gray-12 antialiased">
        {children}
      </body>
    </html>
  );
}
