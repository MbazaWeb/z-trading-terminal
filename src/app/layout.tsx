import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Z TERMINAL - Market Trading Terminal",
  description:
    "Professional real-time market trading terminal with candlestick charts, order book, and live ticker data.",
  keywords: [
    "trading terminal",
    "crypto",
    "stocks",
    "candlestick chart",
    "order book",
    "market data",
  ],
  authors: [{ name: "Z Terminal" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ErrorBoundary>{children}</ErrorBoundary>
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
