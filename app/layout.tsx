import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://localhost:3000"),
  title: "云岫 · 体素山水",
  description: "一座由体素拼合而成、瀑布穿过云海的可交互 Three.js 山景。",
  openGraph: {
    title: "云岫 · 体素山水",
    description: "体素群峰、双瀑入涧、山腰云海——一幅可交互的 Three.js 自然景观。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og.png", width: 1732, height: 908, alt: "云岫体素山水场景" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "云岫 · 体素山水",
    description: "体素群峰、双瀑入涧、山腰云海。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
