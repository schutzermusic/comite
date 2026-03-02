import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Toaster } from '@/components/ui/toaster';
import { getLocale, getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';

export const metadata: Metadata = {
  title: 'Insight Energy Governance Hub',
  description: 'Plataforma de governança corporativa Insight Energy.',
};

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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=PT+Sans:wght@400;700&display=swap" rel="stylesheet" />
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
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
