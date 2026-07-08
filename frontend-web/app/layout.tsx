import type { Metadata } from "next";
import "./globals.css";

import Providers from "./providers";

export const metadata: Metadata = {
  title: "ReLai 哩來語感特訓",
  description: "用 AI 建立你的語感訓練卡片",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className="h-full antialiased">
      <body className="h-full font-sans">
        <Providers>
          <div className="mx-auto flex min-h-screen w-full max-w-app flex-col bg-white sm:my-6 sm:min-h-[calc(100vh-3rem)] sm:rounded-[2.5rem] sm:shadow-xl sm:ring-1 sm:ring-black/5">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
