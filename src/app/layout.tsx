import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DiceDrop',
  description: 'DiceDrop Control Tower',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-screen bg-ink font-sans text-sm text-[#E6EDF3] antialiased">{children}</body>
    </html>
  );
}
