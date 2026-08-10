import type { Metadata, Viewport } from 'next';

/**
 * Metadados do Portal de Ponto (ponto.insightapex.co).
 *
 * `viewportFit: 'cover'` é o que habilita `env(safe-area-inset-*)` no
 * iOS — sem isso a barra inferior fica sob o indicador de gestos. O zoom
 * NÃO é desabilitado (WCAG 2.2 — 1.4.4): `maximumScale` fica em 5.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07090C' },
    { media: '(prefers-color-scheme: light)', color: '#F7F8FA' },
  ],
};

export const metadata: Metadata = {
  title: 'Insight Ponto',
  description: 'Registre sua jornada de trabalho pelo navegador.',
};

export default function PontoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
