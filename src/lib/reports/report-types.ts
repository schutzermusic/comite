/**
 * Shared types for the enterprise PDF/report engine.
 */

/** Standard metadata stamped on every report cover/header/footer. */
export interface ReportMeta {
  /** Workspace / brand label (e.g. "INSIGHT — Governança Corporativa"). */
  brand: string;
  /** Absolute or root-relative logo URL. */
  logoUrl: string;
  /** ISO timestamp the report was generated. */
  generatedAt: string;
  /** Optional author name. */
  generatedBy?: string;
  /** Human period / scope label (e.g. "Jan/26 – Jun/26", "Todos os períodos"). */
  periodLabel?: string;
  /** Active filters summary, rendered on the cover. */
  filtersLabel?: string;
  /** Data source note — e.g. "Supabase", "demonstração". Surfaces demo data. */
  source?: string;
  /** Confidentiality note. Defaults to "Confidencial — uso interno". */
  confidentiality?: string;
}

export type ReportExportResult =
  | { ok: true }
  | { ok: false; reason: 'popup_blocked' | 'error'; message: string };

/** Generic module identifiers used for filenames + the report registry. */
export type ReportModuleKey =
  | 'financeiro'
  | 'projeto'
  | 'agenda'
  | 'deliberacoes'
  | 'riscos'
  | 'contratos'
  | 'pessoas-custos'
  | 'organograma';
