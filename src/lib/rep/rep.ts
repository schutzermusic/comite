/**
 * Ponto Oficial (REP-P) — serviço do módulo fiscal (Fase 9).
 * Configuração do empregador (rep_settings), trilha imutável de
 * exportações (rep_file_exports) e utilitários de hash/download.
 * Live-first via Supabase RLS.
 */
import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import type { RepFileExport, RepFileType, RepSettings } from '@/lib/types/people';
import { getCurrentOrgAndUser, rlsFriendlyMessage } from '@/lib/services/people';

/* ─────────────────────────── settings ────────────────────────── */

type SettingsRow = {
  organization_id: string;
  employer_id_type: 'cnpj' | 'cpf';
  employer_id: string;
  employer_name: string;
  employer_cei: string | null;
  timezone: string;
  developer_id_type: 'cnpj' | 'cpf';
  developer_id: string;
  developer_name: string;
  rep_p_version: string;
  active: boolean;
  notes: string | null;
  updated_at: string;
};

function mapSettings(row: SettingsRow): RepSettings {
  return {
    organizationId: row.organization_id,
    employerIdType: row.employer_id_type,
    employerId: row.employer_id,
    employerName: row.employer_name,
    employerCei: row.employer_cei,
    timezone: row.timezone,
    developerIdType: row.developer_id_type,
    developerId: row.developer_id,
    developerName: row.developer_name,
    repPVersion: row.rep_p_version,
    active: row.active,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export async function getRepSettings(): Promise<RepSettings | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from('rep_settings').select('*').maybeSingle();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar configuração REP-P', error));
  return data ? mapSettings(data as SettingsRow) : null;
}

export interface RepSettingsInput {
  employerIdType: 'cnpj' | 'cpf';
  employerId: string;
  employerName: string;
  employerCei?: string | null;
  timezone?: string;
  developerName?: string;
  developerId?: string;
  active?: boolean;
}

export async function upsertRepSettings(input: RepSettingsInput): Promise<RepSettings> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const { data, error } = await supabase
    .from('rep_settings')
    .upsert(
      {
        organization_id: orgId,
        employer_id_type: input.employerIdType,
        employer_id: input.employerId.replace(/\D/g, ''),
        employer_name: input.employerName.trim(),
        employer_cei: input.employerCei?.replace(/\D/g, '') || null,
        timezone: input.timezone ?? 'America/Sao_Paulo',
        developer_name: input.developerName ?? 'Insight Apex',
        developer_id: input.developerId?.replace(/\D/g, '') ?? '',
        active: input.active ?? false,
        updated_by: userId,
      },
      { onConflict: 'organization_id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(rlsFriendlyMessage('Erro ao salvar configuração REP-P', error));

  void logAuditEvent({
    organizationId: orgId,
    action: 'rep.settings_updated',
    entityType: 'rep_settings',
    entityId: orgId,
    metadata: { active: input.active ?? false },
  });
  return mapSettings(data as SettingsRow);
}

/* ─────────────────────────── exports log ─────────────────────── */

type ExportRow = {
  id: string;
  organization_id: string;
  file_type: RepFileType;
  period_start: string | null;
  period_end: string | null;
  person_id: string | null;
  file_name: string;
  sha256: string;
  record_count: number;
  params: Record<string, unknown> | null;
  generated_by: string | null;
  generated_at: string;
};

function mapExport(row: ExportRow): RepFileExport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    fileType: row.file_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    personId: row.person_id,
    fileName: row.file_name,
    sha256: row.sha256,
    recordCount: row.record_count,
    params: row.params ?? {},
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
  };
}

export async function listRepExports(): Promise<RepFileExport[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('rep_file_exports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(rlsFriendlyMessage('Erro ao carregar exportações', error));
  return (data ?? []).map((r) => mapExport(r as ExportRow));
}

export async function registerRepExport(input: {
  fileType: RepFileType;
  periodStart?: string | null;
  periodEnd?: string | null;
  personId?: string | null;
  fileName: string;
  sha256: string;
  recordCount: number;
  params?: Record<string, unknown>;
}): Promise<void> {
  const supabase = createClient();
  const { userId, orgId } = await getCurrentOrgAndUser(supabase);
  const { error } = await supabase.from('rep_file_exports').insert({
    organization_id: orgId,
    file_type: input.fileType,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    person_id: input.personId ?? null,
    file_name: input.fileName,
    sha256: input.sha256,
    record_count: input.recordCount,
    params: input.params ?? {},
    generated_by: userId,
  });
  if (error) throw new Error(rlsFriendlyMessage('Erro ao registrar exportação', error));

  void logAuditEvent({
    organizationId: orgId,
    action: `rep.${input.fileType}_generated`,
    entityType: 'rep_file_export',
    metadata: { file: input.fileName, sha256: input.sha256, records: input.recordCount },
  });
}

/* ─────────────────────────── utilities ───────────────────────── */

/** SHA-256 (hex) via Web Crypto — usado na trilha de exportação. */
export async function sha256Hex(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Dispara o download de um arquivo texto no navegador. */
export function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Abre uma janela de impressão com o HTML fornecido (padrão do report engine). */
export function openPrintWindow(title: string, bodyHtml: string): void {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:24px}
  h1{font-size:16px;margin:0 0 2px} h2{font-size:13px;margin:16px 0 6px}
  table{border-collapse:collapse;width:100%;margin-top:8px}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left;font-size:11px}
  th{background:#eee}
  .muted{color:#555;font-size:11px}
  .mono{font-family:monospace;font-size:10px;word-break:break-all}
  .sign{margin-top:48px;display:flex;gap:48px}
  .sign div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center;font-size:11px}
  @media print {.no-print{display:none}}
</style></head><body>${bodyHtml}
<script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}