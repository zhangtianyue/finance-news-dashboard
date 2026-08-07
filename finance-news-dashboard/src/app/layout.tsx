import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "盘前财经早报",
  description: "每日开盘前自动生成的财经热点 Dashboard",
};

const themeInitializationScript = `
try {
  const storedTheme = localStorage.getItem("finance-dashboard-theme");
  const theme = storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = "light";
}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full" suppressHydrationWarning>
      <head>
        <Script id="initialize-dashboard-theme" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
