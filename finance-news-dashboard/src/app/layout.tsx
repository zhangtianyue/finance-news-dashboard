import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "开盘前财经早报",
  description: "每日开盘前自动生成的财经热点 Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
