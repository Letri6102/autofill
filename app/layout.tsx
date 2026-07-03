import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Google Form Parser",
  description: "Nhập link Google Form để lấy section, câu hỏi, entry và options.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
