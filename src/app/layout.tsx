import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PNG Shop · ระบบร้านค้าสวัสดิการ",
  description:
    "POS + สต็อก + สมาชิก + รายงาน สำหรับร้านค้าสวัสดิการ — Next.js 16 + Prisma + shadcn/ui",
  keywords: [
    "PNG Shop",
    "ร้านค้าสวัสดิการ",
    "POS",
    "Next.js",
    "Prisma",
    "shadcn/ui",
  ],
  authors: [{ name: "PNG TEAM" }],
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
    <html lang="th" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <QueryProvider>{children}</QueryProvider>
        <SonnerToaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
