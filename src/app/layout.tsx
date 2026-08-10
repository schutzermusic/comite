import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { HudToaster } from '@/components/hud/HudToaster';
import { getLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthHashRouter } from '@/components/auth/AuthHashRouter';
import { SpeedInsights } from '@vercel/speed-insights/next';

export const metadata: Metadata = {
  title: 'Insight Apex Board — Executive Governance Control Room',
  description: 'Insight Apex Board — Governança executiva em tempo real.',
};

// Inline script to prevent FOUC — runs before React hydrates
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem('insight-theme-preference');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var d = document.documentElement;
    d.setAttribute('data-theme', t);
    if (t === 'light') { d.classList.add('light'); d.classList.remove('dark'); }
    else { d.classList.add('dark'); d.classList.remove('light'); }
  } catch(e) {}
})();
`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --insight-orange: #FF7A3D;
            --insight-orange-dark: #E6662A;
            --insight-orange-light: #FFB899;
            --insight-green: #008751;
            --insight-green-dark: #006B40;
            --insight-green-light: #4CAF7B;
          }
        `}</style>
      </head>
      <body className={cn('font-body antialiased')}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <AuthHashRouter />
            {children}
            <HudToaster />
          </ThemeProvider>
        </NextIntlClientProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
