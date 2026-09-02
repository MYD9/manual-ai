import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Manual AI · 我的说明书',
  description: '把设备资料与使用经验，收进自己的知识库。',
  metadataBase: new URL('http://127.0.0.1:8765'),
  openGraph: {
    title: 'Manual AI',
    description: 'Your manuals. Your knowledge.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Manual AI',
    description: 'Your manuals. Your knowledge.',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
