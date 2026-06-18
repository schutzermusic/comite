/**
 * Generic open-in-print-window flow + filename builder shared by every report.
 * No PDF library — the report is a print-ready HTML document the browser saves
 * as PDF via the print dialog (same proven approach as the original exports).
 */

import { PRODUCT_DEFAULT_LOGO_URL } from '@/lib/branding';
import type { ReportExportResult, ReportMeta, ReportModuleKey } from './report-types';

/** Resolve an absolute logo URL so the asset loads in the new print window. */
export function resolveLogoUrl(logoUrl?: string): string {
  if (logoUrl) {
    // Already absolute (http/https/data) → use as-is.
    if (/^(https?:)?\/\//.test(logoUrl) || logoUrl.startsWith('data:')) return logoUrl;
    if (typeof window !== 'undefined') return `${window.location.origin}${logoUrl.startsWith('/') ? '' : '/'}${logoUrl}`;
    return logoUrl;
  }
  const fallback = encodeURI(PRODUCT_DEFAULT_LOGO_URL);
  return typeof window !== 'undefined' ? `${window.location.origin}${fallback}` : fallback;
}

/** Build a default ReportMeta, filling brand/logo/timestamp defaults. */
export function buildReportMeta(partial: Partial<ReportMeta> & Pick<ReportMeta, 'brand'>): ReportMeta {
  return {
    brand: partial.brand,
    logoUrl: resolveLogoUrl(partial.logoUrl),
    generatedAt: partial.generatedAt ?? new Date().toISOString(),
    generatedBy: partial.generatedBy,
    periodLabel: partial.periodLabel,
    filtersLabel: partial.filtersLabel,
    source: partial.source,
    confidentiality: partial.confidentiality,
  };
}

function slug(s: string): string {
  return (s || '')
    .toString()
    .normalize('NFD')
    // strip combining diacritical marks (U+0300–U+036F)
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Filename pattern: {module}-report-{context}-{YYYY-MM-DD}
 * (no extension — the browser's Save-as-PDF dialog appends `.pdf`).
 */
export function buildReportFileName(input: { module: ReportModuleKey | string; context?: string; date?: Date }): string {
  const ymd = (input.date ?? new Date()).toISOString().slice(0, 10);
  const ctx = input.context ? `-${slug(input.context)}` : '';
  return `${slug(String(input.module))}-report${ctx}-${ymd}`;
}

/** Open a print-ready HTML document in a new window (user prints / saves as PDF). */
export function openReport(html: string, opts?: { width?: number; height?: number }): ReportExportResult {
  try {
    const w = window.open('', '_blank', `width=${opts?.width ?? 1280},height=${opts?.height ?? 860}`);
    if (!w) {
      return { ok: false, reason: 'popup_blocked', message: 'O navegador bloqueou a janela. Habilite pop-ups para este site.' };
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : 'Falha ao gerar o relatório.' };
  }
}
