import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DiceDrop',
  description: 'DiceDrop Control Tower',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('dd-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}" +
              // Highlighting words inside a row or button must not also press it.
              "document.addEventListener('click',function(e){try{var s=window.getSelection();if(s&&!s.isCollapsed&&s.toString().trim()&&e.target instanceof Node&&s.containsNode(e.target,true)){e.stopPropagation();e.preventDefault();}}catch(x){}},true);",
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&family=VT323&display=swap"
        />
      </head>
      <body className="min-h-screen bg-ink font-sans text-sm text-fg antialiased">{children}</body>
    </html>
  );
}
