'use client';

/**
 * Resolve a marca da empresa para os documentos exportados.
 *
 * Busca o logo que o administrador subiu em Configurações › Branding, converte
 * para data URI e mede a proporção REAL da imagem — os três destinos (PDF, deck
 * HTML e PowerPoint) precisam dos bytes embutidos e do formato correto, e
 * nenhum deles pode depender de uma URL remota.
 *
 * ─── Nunca quebra o export ────────────────────────────────────────────────
 *
 * Toda falha — sem organização, sem logo, host fora do ar, CORS, arquivo
 * corrompido — cai na marca do produto. Um relatório de board com imagem
 * quebrada é pior que um relatório com a marca da plataforma, então o caminho
 * de erro é sempre silencioso e sempre entrega algo renderizável.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/hooks/use-current-user';
import { getLogoUrl, hasCustomLogo } from '@/lib/branding';
import {
  buildReportBranding,
  DEFAULT_LOGO_ASPECT,
  FALLBACK_REPORT_BRANDING,
  type ReportBranding,
} from '@/lib/reports/report-branding';

/** Acima disso o data URI inflaria o deck e o PPTX sem ganho visual. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha ao ler a imagem do logo.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Proporção real da imagem.
 *
 * SVG sem `width`/`height` explícitos reporta `naturalWidth: 0` em vários
 * navegadores; nesse caso vale a proporção padrão em vez de uma divisão por
 * zero que produziria um logo de altura infinita.
 */
async function measureAspect(dataUri: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      resolve(w > 0 && h > 0 ? w / h : DEFAULT_LOGO_ASPECT);
    };
    img.onerror = () => resolve(DEFAULT_LOGO_ASPECT);
    img.src = dataUri;
  });
}

export interface UseReportBrandingResult {
  branding: ReportBranding;
  /** Verdadeiro enquanto o logo próprio ainda está sendo resolvido. */
  loading: boolean;
}

export function useReportBranding(): UseReportBrandingResult {
  const { organization } = useCurrentUser();
  const [resolved, setResolved] = useState<{ dataUri: string; aspect: number } | null>(null);
  const [loading, setLoading] = useState(false);

  // Evita rebuscar a mesma URL a cada render do cockpit.
  const lastUrlRef = useRef<string | null>(null);

  const logoUrl = organization && hasCustomLogo(organization) ? getLogoUrl(organization) : null;

  useEffect(() => {
    if (!logoUrl) {
      lastUrlRef.current = null;
      setResolved(null);
      return;
    }
    if (lastUrlRef.current === logoUrl) return;
    lastUrlRef.current = logoUrl;

    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const res = await fetch(logoUrl, { cache: 'force-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const blob = await res.blob();
        if (blob.size === 0 || blob.size > MAX_LOGO_BYTES) {
          throw new Error('Logo vazio ou acima do limite.');
        }

        const dataUri = await blobToDataUri(blob);
        const aspect = await measureAspect(dataUri);
        if (!cancelled) setResolved({ dataUri, aspect });
      } catch {
        // Silencioso por decisão: o export continua, com a marca do produto.
        if (!cancelled) setResolved(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [logoUrl]);

  const branding = useMemo(
    () => buildReportBranding(organization, resolved),
    [organization, resolved],
  );

  return { branding, loading };
}

export { FALLBACK_REPORT_BRANDING };
