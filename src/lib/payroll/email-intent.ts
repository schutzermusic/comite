/**
 * E-MAIL DO FECHAMENTO DA FOLHA — o contrato tipado. Puro: sem banco, sem rede.
 *
 * O navegador diz QUAL fechamento enviar, para QUEM (referências a membros da
 * organização ou a contatos externos autorizados) e QUAIS anexos (ids do
 * armazenamento seguro). Remetente, assunto, corpo e bytes de anexo são do
 * servidor. Um corpo com `from`, `subject`, `html`, `recipients`, `cc`/`bcc`
 * em texto ou `attachments` em base64 é RECUSADO — não ignorado — para que um
 * cliente antigo falhe alto em vez de mandar outra coisa.
 */
import { createHash } from 'node:crypto';
import { buildComparison } from '@/lib/payroll/parser';
import type {
  PayrollAttachmentFileType, PayrollClosingStatus, PayrollCostCenterTotal, PayrollEmailAudience, PayrollNarrative,
  PayrollParseResult, PayrollSecurityLevel,
} from '@/lib/types/payroll-closing';

export const PAYROLL_EMAIL_KIND = 'payroll_closing_package';
/** Chave da narrativa do servidor em `payroll_closing_batches.metadata`. */
export const NARRATIVE_METADATA_KEY = 'email_narrative';
export const MAX_PAYROLL_RECIPIENTS = 30;
export const MAX_PAYROLL_ATTACHMENTS = 20;
export const MAX_PAYROLL_ATTACHMENT_BYTES = 40 * 1024 * 1024;

export type RecipientRef = { type: 'member' | 'contact'; id: string };

export interface PayrollEmailIntent {
  kind: typeof PAYROLL_EMAIL_KIND;
  batch_id: string;
  audience: PayrollEmailAudience;
  to: RecipientRef[];
  cc: RecipientRef[];
  attachment_ids: string[];
  confirm_sensitive: boolean;
  /** Uma por clique: repetir a mesma intenção é o mesmo pacote e o mesmo e-mail. */
  request_id: string;
  /** Ensaio: resolve e valida tudo, não envia nem registra. */
  test: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIENCES: PayrollEmailAudience[] = ['board', 'finance', 'hr', 'custom'];
const ALLOWED = new Set(['kind', 'batch_id', 'audience', 'to', 'cc', 'attachment_ids', 'confirm_sensitive', 'request_id', 'test']);

export type IntentResult = { ok: true; intent: PayrollEmailIntent } | { ok: false; error: string };

function refs(value: unknown, field: string): RecipientRef[] | string {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return `${field} deve ser uma lista de referências.`;
  const out: RecipientRef[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${field}: referência inválida.`;
    const r = v as Record<string, unknown>;
    const keys = Object.keys(r);
    if (keys.some((k) => k !== 'type' && k !== 'id')) return `${field}: a referência só leva type e id — o endereço vem do servidor.`;
    if ((r.type !== 'member' && r.type !== 'contact') || typeof r.id !== 'string' || !UUID.test(r.id)) {
      return `${field}: referência inválida (type member|contact e id).`;
    }
    out.push({ type: r.type, id: r.id.toLowerCase() });
  }
  return out;
}

export function parsePayrollEmailIntent(body: unknown): IntentResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Corpo inválido.' };
  const b = body as Record<string, unknown>;
  const extra = Object.keys(b).filter((k) => !ALLOWED.has(k));
  if (extra.length > 0) {
    return { ok: false, error: `Campos não aceitos (${extra.sort().join(', ')}): remetente, destinatários, assunto, corpo e anexos são definidos pelo servidor.` };
  }
  if (b.kind !== PAYROLL_EMAIL_KIND) return { ok: false, error: `kind deve ser "${PAYROLL_EMAIL_KIND}".` };
  if (typeof b.batch_id !== 'string' || !UUID.test(b.batch_id)) return { ok: false, error: 'batch_id inválido.' };
  if (typeof b.request_id !== 'string' || !UUID.test(b.request_id)) return { ok: false, error: 'request_id inválido.' };
  const audience = (b.audience ?? 'custom') as PayrollEmailAudience;
  if (!AUDIENCES.includes(audience)) return { ok: false, error: 'audience inválida.' };
  const to = refs(b.to, 'to');
  if (typeof to === 'string') return { ok: false, error: to };
  const cc = refs(b.cc, 'cc');
  if (typeof cc === 'string') return { ok: false, error: cc };
  if (to.length === 0) return { ok: false, error: 'Escolha ao menos um destinatário.' };
  if (to.length + cc.length > MAX_PAYROLL_RECIPIENTS) return { ok: false, error: `No máximo ${MAX_PAYROLL_RECIPIENTS} destinatários.` };
  const ids = b.attachment_ids ?? [];
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string' || !UUID.test(x))) return { ok: false, error: 'attachment_ids inválidos.' };
  if (ids.length > MAX_PAYROLL_ATTACHMENTS) return { ok: false, error: `No máximo ${MAX_PAYROLL_ATTACHMENTS} anexos.` };
  if (b.confirm_sensitive !== undefined && typeof b.confirm_sensitive !== 'boolean') return { ok: false, error: 'confirm_sensitive inválido.' };
  if (b.test !== undefined && typeof b.test !== 'boolean') return { ok: false, error: 'test inválido.' };
  return {
    ok: true,
    intent: {
      kind: PAYROLL_EMAIL_KIND, batch_id: b.batch_id.toLowerCase(), audience, to, cc,
      attachment_ids: [...new Set((ids as string[]).map((x) => x.toLowerCase()))],
      confirm_sensitive: b.confirm_sensitive === true, request_id: b.request_id.toLowerCase(), test: b.test === true,
    },
  };
}

/** Assunto do servidor — o mesmo que a tela sempre mostrou. */
export function payrollEmailSubject(competenceMonth: string): string {
  return `Fechamento da Folha — ${String(competenceMonth).replace(/[\r\n\t]+/g, ' ').trim()}`;
}

/** Fechamento em que um envio faz sentido: tem números e não foi cancelado. */
export function batchSendable(status: PayrollClosingStatus, parse: PayrollParseResult): string | null {
  if (status === 'cancelled') return 'Fechamento cancelado: não há o que enviar.';
  if (parse.cost_centers.length === 0 && parse.total_amount_cents === 0) return 'Fechamento sem dados processados: importe a folha antes de enviar.';
  return null;
}

/** O bucket onde cada tipo de anexo mora (IMPORT_TYPE_MAP + relatórios gerados). */
export const ATTACHMENT_BUCKET: Partial<Record<PayrollAttachmentFileType, string>> = {
  payroll_spreadsheet: 'payroll-imports',
  bank_payment_spreadsheet: 'payroll-bank-files',
  holerite: 'payroll-holerites',
  external_holerite: 'payroll-holerites',
  supporting_document: 'payroll-supporting-documents',
  executive_pdf: 'payroll-reports',
  dashboard_snapshot: 'payroll-reports',
};

/**
 * Por que a linha de anexo NÃO pode ser baixada pelo servidor — ou null.
 * O service role baixa o que a linha aponta; então a linha precisa apontar
 * para o bucket do seu tipo e para dentro de `<organização>/<fechamento>/`.
 */
export function attachmentLocationProblem(
  row: { file_type?: unknown; storage_bucket?: unknown; object_path?: unknown; batch_id?: unknown },
  organizationId: string,
): string | null {
  const expected = ATTACHMENT_BUCKET[row.file_type as PayrollAttachmentFileType];
  if (!expected) return 'tipo de anexo sem bucket conhecido';
  if (row.storage_bucket !== expected) return 'bucket não corresponde ao tipo do anexo';
  const path = typeof row.object_path === 'string' ? row.object_path : '';
  // O servidor só grava caminhos com [A-Za-z0-9._-] e "/" (ver sanitize() no
  // repositório): qualquer outra coisa — '%2e%2e', '//', '\\', controle — não é dele.
  if (!path || !/^[A-Za-z0-9._\/-]+$/.test(path) || path.startsWith('/') || path.includes('..') || path.includes('//')) return 'caminho inválido';
  if (!path.startsWith(`${organizationId}/${String(row.batch_id)}/`)) return 'caminho fora desta organização e fechamento';
  return null;
}

/**
 * Permissões que um anexo exige para SAIR por e-mail. Decididas pelo BUCKET de
 * onde os bytes vêm (não só pelo rótulo da linha): a base é poder ler o
 * armazenamento da folha (`people.payroll_close`); holerite e arquivo bancário
 * pedem a permissão da RLS deles; o que não é agregado pede envio sensível.
 */
export function attachmentSendPermissions(fileType: PayrollAttachmentFileType, level: PayrollSecurityLevel, bucket?: string): string[] {
  const out = new Set<string>(['people.payroll_close']);
  const b = bucket ?? ATTACHMENT_BUCKET[fileType];
  if (b === 'payroll-holerites' || fileType === 'holerite' || fileType === 'external_holerite') {
    out.add('people.payroll_holerite_access'); out.add('people.payroll_send_sensitive');
  }
  if (b === 'payroll-bank-files' || fileType === 'bank_payment_spreadsheet' || fileType === 'remittance_file') {
    out.add('people.payroll_bank_file_access'); out.add('people.payroll_send_sensitive');
  }
  if (b === 'payroll-imports' || level !== 'aggregate') out.add('people.payroll_send_sensitive');
  return [...out];
}

/**
 * Resumo da intenção: o que o pacote promete entregar. A mesma chave
 * (`request_id`) com OUTRO resumo não reaproveita o pacote — é recusada.
 */
export function payrollIntentDigest(intent: PayrollEmailIntent): string {
  const refsKey = (xs: RecipientRef[]) => xs.map((r) => `${r.type}:${r.id.toLowerCase()}`).sort();
  const canonical = JSON.stringify([intent.batch_id.toLowerCase(), intent.audience, refsKey(intent.to), refsKey(intent.cc),
    [...intent.attachment_ids].map((x) => x.toLowerCase()).sort(), intent.confirm_sensitive]);
  return createHash('sha256').update(canonical).digest('hex');
}

const GENERATED_TYPES = new Set<PayrollAttachmentFileType>(['executive_pdf', 'dashboard_snapshot']);
/** Extensões que um anexo ENVIADO pode ter, e o tipo MIME que o servidor declara para cada uma. */
export const SENDABLE_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
};

/**
 * Nome e tipo do anexo como SAEM no e-mail: nome sem caracteres de controle
 * nem de direção (o "holerite‮fdp.exe"), extensão da lista, tipo MIME do
 * servidor (não o que o upload declarou). HTML só para os relatórios que o
 * próprio servidor gera.
 */
export function attachmentFilePolicy(fileType: PayrollAttachmentFileType, fileName: string):
  { ok: true; filename: string; contentType: string } | { ok: false; error: string } {
  const cleaned = String(fileName ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120);
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(cleaned);
  const ext = m ? m[1].toLowerCase() : '';
  if (GENERATED_TYPES.has(fileType)) {
    if (ext !== 'html') return { ok: false, error: 'Relatório gerado fora do formato.' };
    return { ok: true, filename: cleaned, contentType: 'text/html; charset=utf-8' };
  }
  const contentType = SENDABLE_EXTENSIONS[ext];
  if (!contentType || !cleaned || cleaned.startsWith('.')) {
    return { ok: false, error: `Tipo de arquivo não enviável por e-mail (.${ext || '?'}).` };
  }
  return { ok: true, filename: cleaned, contentType };
}

/** Os números que descrevem o fechamento — mudou isto, a narrativa e os relatórios envelheceram. */
export function numbersSignature(
  totals: { total_amount_cents?: unknown; previous_month_amount_cents?: unknown; competence_month?: unknown;
    headcount?: unknown; payment_deadline?: unknown },
  centers: Array<{ cost_center_label?: unknown; amount_cents?: unknown; previous_amount_cents?: unknown }>,
  flagCodes: Array<unknown> = [],
): string {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? '' : String(Number(v)));
  const t = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim().slice(0, 10));
  const rows = centers.map((c) => `${String(c.cost_center_label ?? '')}|${n(c.amount_cents)}|${n(c.previous_amount_cents)}`).sort();
  return [n(totals.total_amount_cents), n(totals.previous_month_amount_cents), t(totals.competence_month),
    n(totals.headcount), t(totals.payment_deadline), [...flagCodes].map(String).sort().join(','), ...rows].join('\n');
}

/** A assinatura dos fatos que a narrativa e os relatórios gerados descrevem. */
export const factsSignature = (p: PayrollParseResult) =>
  numbersSignature(p, p.cost_centers, p.flags.map((f) => f.code));

/**
 * O resultado da leitura da planilha chega do navegador (a planilha é lida lá).
 * Antes de guardar: competência no formato, números finitos, rótulos curtos e
 * sem caracteres de controle — é texto que depois aparece no e-mail e no relatório.
 */
export function sanitizeParseForSave(parse: PayrollParseResult): { ok: true; parse: PayrollParseResult } | { ok: false; error: string } {
  if (!parse || typeof parse !== 'object' || !Array.isArray(parse.cost_centers)) return { ok: false, error: 'Resultado da leitura inválido.' };
  if (!/^(\d{4}-\d{2})?$/.test(String(parse.competence_month ?? ''))) return { ok: false, error: 'Competência fora do formato AAAA-MM.' };
  const numbers = [parse.total_amount_cents, parse.previous_month_amount_cents, parse.variation_amount_cents, parse.variation_percentage,
    ...parse.cost_centers.map((c) => c.amount_cents)];
  if (numbers.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return { ok: false, error: 'Valores numéricos inválidos.' };
  if (parse.cost_centers.length > 500 || (parse.employees ?? []).length > 20000 || (parse.flags ?? []).length > 1000) {
    return { ok: false, error: 'Leitura grande demais.' };
  }
  const label = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
  return {
    ok: true,
    parse: {
      ...parse,
      cost_centers: parse.cost_centers.map((c) => ({ ...c, cost_center_label: label(c.cost_center_label, 160) })),
      employees: (parse.employees ?? []).map((e) => ({ ...e, employee_name: label(e.employee_name, 200), cost_center_label: e.cost_center_label ? label(e.cost_center_label, 160) : e.cost_center_label })),
      flags: (parse.flags ?? []).map((f) => ({ ...f, code: label(f.code, 80), message: label(f.message, 500) })),
    },
  };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const list = (v: unknown, max: number) =>
  (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, max)) : []);

/**
 * A narrativa guardada pelo servidor, validada na leitura: só texto, com teto.
 * O que não for do formato vira ausência — nunca é repassado como veio.
 */
export function coerceNarrative(raw: unknown): PayrollNarrative | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const n = raw as Record<string, unknown>;
  const narrative: PayrollNarrative = {
    executive_summary: text(n.executive_summary, 4000), closing_email: text(n.closing_email, 4000),
    board_summary: text(n.board_summary, 4000), finance_email: text(n.finance_email, 4000),
    hr_validation: text(n.hr_validation, 4000), top_increases: list(n.top_increases, 500),
    top_decreases: list(n.top_decreases, 500), cost_center_highlights: list(n.cost_center_highlights, 500),
    anomalies: list(n.anomalies, 500), attention_points: list(n.attention_points, 500),
    recommendations: list(n.recommendations, 500), conclusion: text(n.conclusion, 4000),
    generated_by_ai: n.generated_by_ai === true,
  };
  const meta = n.ai_metadata as PayrollNarrative['ai_metadata'] | undefined;
  if (meta && typeof meta === 'object') narrative.ai_metadata = meta;
  return narrative;
}

const num = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const optNum = (v: unknown) => (v === null || v === undefined ? undefined : num(v));

/**
 * O resultado da leitura da folha, remontado do que o banco guardou — só o
 * agregado (sem pessoas, sem contas bancárias): é o que o e-mail e os
 * relatórios gerados usam.
 */
export function factsToParse(
  batch: Record<string, unknown>, centers: Array<Record<string, unknown>>, contractTypes: Array<string | null>,
): PayrollParseResult {
  const cost_centers: PayrollCostCenterTotal[] = centers.map((c) => ({
    cost_center_label: String(c.cost_center_label ?? ''),
    cost_center_id: (c.matched_cost_center_id as string | null) ?? undefined,
    amount_cents: num(c.amount_cents),
    previous_amount_cents: optNum(c.previous_amount_cents),
    variation_amount_cents: optNum(c.variation_amount_cents),
    variation_percentage: optNum(c.variation_percentage),
  }));
  const total = num(batch.total_amount_cents);
  const previous = num(batch.previous_month_amount_cents);
  const clt = contractTypes.filter((t) => t === 'CLT').length;
  const pj = contractTypes.filter((t) => t === 'PJ').length;
  return {
    competence_month: String(batch.competence_month ?? '').trim(),
    total_amount_cents: total,
    previous_month_amount_cents: previous,
    variation_amount_cents: num(batch.variation_amount_cents),
    variation_percentage: num(batch.variation_percentage),
    gross_amount_cents: optNum(batch.gross_amount_cents),
    charges_amount_cents: optNum(batch.charges_amount_cents),
    benefits_amount_cents: optNum(batch.benefits_amount_cents),
    headcount: optNum(batch.headcount),
    clt_count: clt || undefined,
    pj_count: pj || undefined,
    payment_deadline: (batch.payment_deadline as string | null) ?? undefined,
    cost_centers,
    employees: [],
    bank_lines: [],
    comparison: buildComparison(total, previous, cost_centers),
    flags: [],
    detected_sheets: [],
    reconciled: true,
  };
}
