/**
 * Alertas de vencimento de ASO para o RH.
 *
 * Camada pura. Junta as duas fontes que hoje existem separadas — o documento
 * enviado (validade DECLARADA) e o evento S-2220 do eSocial (validade
 * INFERIDA) — e produz uma fila por trabalhador, ordenada pelo que vence
 * primeiro.
 *
 * A PRECEDÊNCIA É O CORAÇÃO DESTE MÓDULO
 *
 * Quando as duas fontes existem, vale o documento: ele DECLARA a validade, o
 * eSocial só permite deduzi-la. Inverter isso faria o sistema ignorar a data
 * escrita no papel em favor de uma premissa nossa — e a premissa só cobre o
 * exame periódico.
 *
 * E o alerta nunca é emitido sobre uma base que não existe: quem não tem nem
 * documento nem evento aparece em "sem ASO no acervo", que é um pedido de
 * conferência, e não uma afirmação de irregularidade. O pacote do eSocial
 * Download tem janela de retenção e o RH pode ter o papel na gaveta.
 */

export type AsoAlertLevel =
  /** Vencido: a data apurada já passou. */
  | 'expired'
  /** Vence dentro da janela crítica. */
  | 'critical'
  /** Vence dentro da janela de aviso. */
  | 'warning'
  /** Em dia. */
  | 'ok'
  /** Há exame, mas nada permite apurar vencimento. */
  | 'undetermined'
  /** Nenhum exame no acervo — nem documento, nem evento. */
  | 'absent';

export type AsoAlertSource = 'document' | 'esocial' | 'none';

export interface AsoAlert {
  workerKey: string;
  personId: string | null;
  name: string | null;
  areaLabel: string | null;
  level: AsoAlertLevel;
  /** Quem sustenta a data — documento declara, eSocial infere. */
  source: AsoAlertSource;
  examDate: string | null;
  examKind: string | null;
  validUntil: string | null;
  daysToExpiry: number | null;
  documentId: string | null;
  /** Frase pronta explicando o estado, inclusive quando ele é "não sei". */
  reason: string;
}

export interface AsoAlertWorker {
  workerKey: string;
  personId?: string | null;
  name: string | null;
  areaLabel: string | null;
}

export interface AsoAlertDocument {
  id: string;
  workerKey: string | null;
  personId: string | null;
  examDate: string | null;
  examKind: string | null;
  validUntil: string | null;
  validityBasis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  status: 'pending_review' | 'confirmed' | 'rejected';
}

export interface AsoAlertEsocialExam {
  workerKey: string | null;
  examDate: string | null;
  examKind: string | null;
  /** `null` quando a periodicidade não é apurável para o tipo de exame. */
  validUntil: string | null;
}

export interface AsoAlertWindows {
  /** Dias para o nível `critical`. */
  critical: number;
  /** Dias para o nível `warning`. */
  warning: number;
}

export const DEFAULT_ASO_WINDOWS: AsoAlertWindows = { critical: 30, warning: 60 };

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** Mais recente de dois exames; `null` perde para qualquer data. */
function laterOf<T extends { examDate: string | null }>(a: T | null, b: T): T {
  if (!a) return b;
  if (!a.examDate) return b;
  if (!b.examDate) return a;
  return b.examDate > a.examDate ? b : a;
}

export function buildAsoAlerts(input: {
  workers: AsoAlertWorker[];
  documents: AsoAlertDocument[];
  esocialExams: AsoAlertEsocialExam[];
  reference?: Date;
  windows?: AsoAlertWindows;
}): AsoAlert[] {
  const today = (input.reference ?? new Date()).toISOString().slice(0, 10);
  const windows = input.windows ?? DEFAULT_ASO_WINDOWS;

  // Documento rejeitado na curadoria não sustenta nada — foi olhado por uma
  // pessoa e recusado. Continuar contando com ele seria ignorar a revisão.
  const usableDocs = input.documents.filter((d) => d.status !== 'rejected');

  const docByWorker = new Map<string, AsoAlertDocument>();
  for (const doc of usableDocs) {
    const key = doc.workerKey ?? (doc.personId ? `person:${doc.personId}` : null);
    if (!key) continue;
    docByWorker.set(key, laterOf(docByWorker.get(key) ?? null, doc));
  }

  const examByWorker = new Map<string, AsoAlertEsocialExam>();
  for (const exam of input.esocialExams) {
    if (!exam.workerKey) continue;
    examByWorker.set(exam.workerKey, laterOf(examByWorker.get(exam.workerKey) ?? null, exam));
  }

  const alerts: AsoAlert[] = input.workers.map((worker) => {
    const doc =
      docByWorker.get(worker.workerKey) ??
      (worker.personId ? docByWorker.get(`person:${worker.personId}`) : undefined);
    const exam = examByWorker.get(worker.workerKey);

    const base = {
      workerKey: worker.workerKey,
      personId: worker.personId ?? null,
      name: worker.name,
      areaLabel: worker.areaLabel,
      documentId: doc?.id ?? null,
    };

    // ── Nenhuma fonte ──
    if (!doc && !exam) {
      return {
        ...base,
        level: 'absent' as const,
        source: 'none' as const,
        examDate: null,
        examKind: null,
        validUntil: null,
        daysToExpiry: null,
        reason:
          'Nenhum ASO no acervo — nem documento enviado, nem evento S-2220 importado. Confirme se o exame existe e não foi digitalizado.',
      };
    }

    // ── Precedência: o documento declara, o eSocial infere ──
    const preferDoc = Boolean(doc?.validUntil) || !exam?.validUntil;
    const chosen = preferDoc && doc ? doc : exam ?? doc!;
    const source: AsoAlertSource = chosen === doc ? 'document' : 'esocial';
    const validUntil = chosen?.validUntil ?? null;
    const examDate = chosen?.examDate ?? null;
    const examKind = chosen?.examKind ?? null;

    if (!validUntil) {
      return {
        ...base,
        level: 'undetermined' as const,
        source,
        examDate,
        examKind,
        validUntil: null,
        daysToExpiry: null,
        reason: doc
          ? 'O ASO enviado não declara data de validade e o tipo de exame não permite deduzi-la. Verifique o documento ou registre a validade manualmente.'
          : 'O evento S-2220 não declara validade e o tipo de exame não permite deduzi-la. Envie o PDF do ASO para obter a data declarada.',
      };
    }

    const daysToExpiry = daysBetween(today, validUntil);
    const level: AsoAlertLevel =
      daysToExpiry < 0
        ? 'expired'
        : daysToExpiry <= windows.critical
          ? 'critical'
          : daysToExpiry <= windows.warning
            ? 'warning'
            : 'ok';

    const basisNote =
      source === 'document'
        ? doc?.validityBasis === 'declared_document'
          ? 'validade declarada no documento'
          : 'validade inferida a partir do documento'
        : 'validade inferida do evento do eSocial';

    const reason =
      level === 'expired'
        ? `ASO vencido há ${Math.abs(daysToExpiry)} dia(s) — ${basisNote}.`
        : level === 'ok'
          ? `Em dia; vence em ${daysToExpiry} dia(s) — ${basisNote}.`
          : `Vence em ${daysToExpiry} dia(s) — ${basisNote}.`;

    return { ...base, level, source, examDate, examKind, validUntil, daysToExpiry, reason };
  });

  // Fila de trabalho: o que exige ação primeiro, e dentro disso o que vence antes.
  const order: Record<AsoAlertLevel, number> = {
    expired: 0,
    critical: 1,
    absent: 2,
    warning: 3,
    undetermined: 4,
    ok: 5,
  };
  return alerts.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    if (a.daysToExpiry !== null && b.daysToExpiry !== null) return a.daysToExpiry - b.daysToExpiry;
    return (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR');
  });
}

export interface AsoAlertSummary {
  expired: number;
  critical: number;
  warning: number;
  ok: number;
  undetermined: number;
  absent: number;
  /** Quantos exigem ação do RH agora (vencido + crítico + sem ASO). */
  actionable: number;
  total: number;
}

export function summarizeAsoAlerts(alerts: AsoAlert[]): AsoAlertSummary {
  const summary: AsoAlertSummary = {
    expired: 0, critical: 0, warning: 0, ok: 0, undetermined: 0, absent: 0,
    actionable: 0, total: alerts.length,
  };
  for (const a of alerts) summary[a.level] += 1;
  summary.actionable = summary.expired + summary.critical + summary.absent;
  return summary;
}

/** Assunto e corpo do digest enviado ao RH. */
export function buildAsoDigest(alerts: AsoAlert[], windows: AsoAlertWindows = DEFAULT_ASO_WINDOWS): {
  subject: string;
  html: string;
  text: string;
} {
  const summary = summarizeAsoAlerts(alerts);
  const urgent = alerts.filter((a) => a.level === 'expired' || a.level === 'critical');

  const subject =
    summary.expired > 0
      ? `[SST] ${summary.expired} ASO(s) vencido(s) e ${summary.critical} a vencer em ${windows.critical} dias`
      : `[SST] ${summary.critical} ASO(s) a vencer em até ${windows.critical} dias`;

  const rows = urgent
    .map(
      (a) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(a.name ?? 'Identificação restrita')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(a.areaLabel ?? '—')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${a.validUntil ?? '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:${a.level === 'expired' ? '#b91c1c' : '#b45309'}">
          ${a.level === 'expired' ? `vencido há ${Math.abs(a.daysToExpiry ?? 0)}d` : `vence em ${a.daysToExpiry}d`}
        </td>
      </tr>`,
    )
    .join('');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827">
      <h2 style="margin:0 0 4px">Saúde ocupacional — ASOs a vencer</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px">
        ${summary.expired} vencido(s) · ${summary.critical} vence(m) em até ${windows.critical} dias ·
        ${summary.warning} em até ${windows.warning} dias · ${summary.absent} sem ASO no acervo ·
        ${summary.undetermined} sem vencimento apurável
      </p>
      ${urgent.length
        ? `<table style="border-collapse:collapse;font-size:13px;width:100%">
             <thead><tr style="text-align:left;color:#6b7280">
               <th style="padding:6px 10px">Colaborador</th><th style="padding:6px 10px">Lotação</th>
               <th style="padding:6px 10px">Vence em</th><th style="padding:6px 10px">Situação</th>
             </tr></thead>
             <tbody>${rows}</tbody>
           </table>`
        : '<p style="font-size:13px">Nenhum ASO vencido ou a vencer na janela crítica.</p>'}
      <p style="margin-top:20px;font-size:12px;color:#6b7280">
        ${summary.undetermined} colaborador(es) têm exame sem vencimento apurável — o tipo de exame não
        estabelece periodicidade e o documento não declarou validade. Esses casos não são irregularidade:
        são conferência pendente.
      </p>
    </div>`;

  const text = [
    'Saúde ocupacional — ASOs a vencer',
    `${summary.expired} vencido(s), ${summary.critical} em até ${windows.critical} dias, ${summary.absent} sem ASO no acervo.`,
    '',
    ...urgent.map(
      (a) =>
        `- ${a.name ?? 'Identificação restrita'} (${a.areaLabel ?? '—'}): ${a.validUntil ?? '—'} — ${a.reason}`,
    ),
  ].join('\n');

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
