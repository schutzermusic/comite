/**
 * A FONTE DE MARCADORES DO GLOBO.
 *
 * Um arquivo, uma consulta, uma visão: `project_globe_marker`. O globo não
 * consulta contrato, não consulta cláusula e não consulta gazeteer — a
 * verdade geográfica é do PROJETO, e chegou até a visão pela resolução
 * governada, que deixou proveniência.
 *
 * A visão já garante, no banco, o que a tela não precisa mais garantir:
 *
 *   · no máximo UMA linha por projeto (índice parcial `pcl_one_live_per_project`);
 *   · só estado RESOLVED, com latitude e longitude não nulas;
 *   · proveniência viajando junto (contrato, documento, página).
 *
 * Por isso aqui não há desduplicação, não há fallback e não há "se faltar
 * coordenada, usa o centro do estado". Projeto sem coordenada apurada não
 * aparece — e aparece, em vez disso, em `project_location_attention`.
 */

import { createClient } from '@/utils/supabase/client';

export class ProjectGlobeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ProjectGlobeError';
  }
}

/** Um marcador, já normalizado. Tudo aqui é fato apurado. */
export interface ProjectGlobeMarker {
  readonly projectId: string;
  readonly projectCode: string | null;
  readonly projectName: string | null;
  readonly projectStatus: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly precision: 'site' | 'municipality';
  readonly siteLabel: string | null;
  readonly municipality: string | null;
  readonly stateCode: string | null;
  /** Por que o ponto está ali. Abre o documento, não um texto de ajuda. */
  readonly evidenceKind: string;
  readonly sourceContractId: string | null;
  readonly sourceDocumentId: string | null;
  readonly sourcePage: number | null;
  readonly geocoder: string | null;
  readonly geocodedAt: string | null;
  readonly version: number;
}

export async function listProjectGlobeMarkers(): Promise<readonly ProjectGlobeMarker[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('project_globe_marker')
    .select('organization_id, project_id, project_code, project_name, project_lifecycle_status, latitude, longitude, precision, site_label, municipality, state_code, evidence_kind, source_contract_id, source_document_id, source_page, geocoder, geocoded_at, version')
    .order('project_code', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      throw new ProjectGlobeError(
        'Localização canônica de projeto indisponível: a migration 176 não foi aplicada.',
        error,
      );
    }
    throw new ProjectGlobeError(error.message, error);
  }

  return (data ?? []).flatMap((raw: Record<string, unknown>): ProjectGlobeMarker[] => {
    const latitude = Number(raw.latitude);
    const longitude = Number(raw.longitude);
    // A visão já filtra nulos; a checagem aqui é contra um NaN vindo de
    // transporte, que viraria um ponto no meio do oceano em vez de um erro.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      projectId: String(raw.project_id),
      projectCode: (raw.project_code as string) ?? null,
      projectName: (raw.project_name as string) ?? null,
      projectStatus: (raw.project_lifecycle_status as string) ?? null,
      latitude,
      longitude,
      precision: raw.precision as 'site' | 'municipality',
      siteLabel: (raw.site_label as string) ?? null,
      municipality: (raw.municipality as string) ?? null,
      stateCode: (typeof raw.state_code === 'string' && raw.state_code.trim()
        ? raw.state_code.trim().toUpperCase()
        : typeof raw.stateCode === 'string' && raw.stateCode.trim()
          ? raw.stateCode.trim().toUpperCase()
          : null),
      evidenceKind: String(raw.evidence_kind),
      sourceContractId: (raw.source_contract_id as string) ?? null,
      sourceDocumentId: (raw.source_document_id as string) ?? null,
      sourcePage: (raw.source_page as number) ?? null,
      geocoder: (raw.geocoder as string) ?? null,
      geocodedAt: (raw.geocoded_at as string) ?? null,
      version: (raw.version as number) ?? 1,
    }];
  });
}
