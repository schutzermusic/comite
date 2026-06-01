/**
 * Client-side helpers for the payroll closing flow: API calls to the analyze
 * and send routes, file → base64 conversion, package presets and small
 * formatters. Kept separate from the in-memory store so the page stays lean.
 */

'use client';

import type {
  PayrollAttachmentFileType,
  PayrollNarrative,
  PayrollPackagePreset,
  PayrollParseResult,
  PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ATTACHMENT_TYPE_LABEL: Record<PayrollAttachmentFileType, string> = {
  executive_pdf: 'Relatório Executivo (PDF)',
  dashboard_snapshot: 'Snapshot do Dashboard',
  payroll_spreadsheet: 'Planilha Geral da Folha',
  bank_payment_spreadsheet: 'Planilha Bancária / Pagamento',
  remittance_file: 'Arquivo de Remessa',
  holerite: 'Holerites Internos',
  external_holerite: 'Holerites Externos / Avulsos',
  esocial: 'eSocial',
  tax_guide: 'Guia de Tributos',
  supporting_document: 'Documento de Apoio',
  other: 'Outro',
};

export const SECURITY_LABEL: Record<PayrollSecurityLevel, string> = {
  aggregate: 'Agregado',
  confidential: 'Confidencial',
  finance_restricted: 'Restrito — Financeiro',
  hr_restricted: 'Restrito — RH',
  board_confidential: 'Confidencial — Diretoria',
};

/** Security levels that require explicit confirmation before sending. */
export const SENSITIVE_LEVELS: PayrollSecurityLevel[] = [
  'confidential',
  'finance_restricted',
  'hr_restricted',
  'board_confidential',
];

export function isSensitive(level: PayrollSecurityLevel): boolean {
  return SENSITIVE_LEVELS.includes(level);
}

export const PACKAGE_PRESETS: PayrollPackagePreset[] = [
  {
    audience: 'board',
    label: 'Diretoria',
    description: 'Resumo executivo + snapshot agregado. Sem holerites.',
    default_file_types: ['executive_pdf', 'dashboard_snapshot'],
    max_security_level: 'aggregate',
  },
  {
    audience: 'board',
    label: 'Diretoria (Confidencial)',
    description: 'Pacote da diretoria + planilha geral. Requer confirmação.',
    default_file_types: ['executive_pdf', 'dashboard_snapshot', 'payroll_spreadsheet'],
    max_security_level: 'board_confidential',
  },
  {
    audience: 'finance',
    label: 'Pagamento — Financeiro',
    description: 'Planilha bancária / remessa para liberação do pagamento.',
    default_file_types: ['bank_payment_spreadsheet', 'remittance_file', 'executive_pdf'],
    max_security_level: 'finance_restricted',
  },
  {
    audience: 'hr',
    label: 'RH (Completo)',
    description: 'Todos os arquivos: planilha, banco, holerites e apoio.',
    default_file_types: [
      'payroll_spreadsheet',
      'bank_payment_spreadsheet',
      'holerite',
      'external_holerite',
      'supporting_document',
      'executive_pdf',
      'dashboard_snapshot',
    ],
    max_security_level: 'hr_restricted',
  },
  {
    audience: 'custom',
    label: 'Personalizado',
    description: 'Selecione manualmente os anexos.',
    default_file_types: [],
    max_security_level: 'board_confidential',
  },
];

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── API calls ───────────────────────────────────────────────

export interface AnalyzeResponse {
  ok: boolean;
  narrative?: PayrollNarrative;
  error?: string;
}

export async function requestNarrative(parse: PayrollParseResult): Promise<AnalyzeResponse> {
  const res = await fetch('/api/payroll/ai/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parse }),
  });
  return (await res.json()) as AnalyzeResponse;
}

export interface SendEmailInput {
  subject: string;
  html: string;
  recipients: string[];
  cc?: string[];
  bcc?: string[];
  attachments: Array<{ file_name: string; content_base64: string; mime_type?: string; file_size: number }>;
  /** Supabase mode: server loads these attachments from Storage by id. */
  attachment_ids?: string[];
  batch_id?: string;
  audience?: 'board' | 'finance' | 'hr' | 'custom';
  confirm_sensitive?: boolean;
  test?: boolean;
}

export interface SendEmailResponse {
  ok: boolean;
  delivery_status?: 'pending' | 'sent' | 'failed' | 'simulated';
  provider_message_id?: string;
  reason?: string;
  error?: string;
  message?: string;
  attachments_sent?: Array<{ file_name: string; file_size: number }>;
  total_bytes?: number;
  limit_bytes?: number;
}

export async function sendPayrollEmail(input: SendEmailInput): Promise<SendEmailResponse> {
  const res = await fetch('/api/payroll/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await res.json()) as SendEmailResponse;
}
