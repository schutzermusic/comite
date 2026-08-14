/**
 * Alertas de saúde ocupacional a partir do ACERVO DE ASOs EM PDF.
 *
 * Camada pura. Uma linha por colaborador ativo, ordenada pelo que exige ação
 * primeiro.
 *
 * O QUE DECIDE O NÍVEL É O DOCUMENTO, E SÓ ELE
 *
 * O nível de cada linha sai do PDF aprovado pelo RH. O evento S-2220 do eSocial
 * não participa dessa decisão: ele entra ao lado, como conferência, e no máximo
 * produz um aviso de divergência. Isso é deliberado e é o ponto do módulo —
 * o RH tem o papel na mão meses antes de ter o pacote do eSocial Download, e o
 * controle de ASO não pode ficar refém de uma importação que talvez nunca
 * aconteça.
 *
 * DUAS COISAS QUE ESTE MÓDULO SE RECUSA A DIZER
 *
 * 1. Que um ASO está EM DIA sem um documento aprovado que sustente a data.
 *    Nem confiança de extração alta, nem S-2220 batendo, produzem "em dia".
 * 2. Que quem não enviou o PDF está IRREGULAR. Ele está com o documento não
 *    enviado — que é uma pendência de acervo, não uma infração. A diferença
 *    importa porque a segunda leitura, repetida todo mês, ensina o RH a ignorar
 *    a lista inteira.
 */

import type { AsoDocumentStatus } from './aso-review';

export type AsoAlertLevel =
  /** Documento aprovado, validade apurada e já passou. */
  | 'expired'
  /** Vence dentro da janela crítica (padrão: 30 dias). */
  | 'expiring_30'
  /** Vence dentro da janela de aviso (padrão: 60 dias). */
  | 'expiring_60'
  /** Documento aprovado e dentro do prazo. */
  | 'ok'
  /** Documento aprovado, mas nada permite apurar vencimento. */
  | 'no_validity'
  /** Há PDF no acervo, ainda não revisado por ninguém. */
  | 'pending_review'
  /** PDF rejeitado ou devolvido para correção — o acervo está sem base válida. */
  | 'needs_correction'
  /** Nenhum PDF enviado para este colaborador. */
  | 'no_document';

/**
 * De onde saiu a data que sustenta o nível.
 *
 * `document` é o único valor que pode acompanhar um nível de vencimento —
 * `none` acompanha os estados em que não há data porque não há base.
 */
export type AsoAlertSource = 'document' | 'none';

/** Conferência com o eSocial, quando existe. Nunca altera o nível. */
export interface AsoEsocialCrossCheck {
  eventId: string | null;
  examDate: string | null;
  examKind: string | null;
  /** Vencimento que o eSocial permite DEDUZIR (só o exame periódico). */
  validityDate: string | null;
  status: 'not_imported' | 'matched' | 'divergent' | 'not_applicable';
  /** Frase pronta quando `status = 'divergent'`. */
  summary: string | null;
}

export interface AsoAlert {
  workerKey: string;
  personId: string | null;
  name: string | null;
  areaLabel: string | null;
  level: AsoAlertLevel;
  source: AsoAlertSource;
  documentStatus: AsoDocumentStatus | 'missing';
  examDate: string | null;
  examKind: string | null;
  validityDate: string | null;
  validityBasis: 'declared_document' | 'inferred_periodicity' | 'undetermined' | null;
  daysToExpiry: number | null;
  documentId: string | null;
  esocial: AsoEsocialCrossCheck;
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
  validityDate: string | null;
  validityBasis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  documentStatus: AsoDocumentStatus;
  esocialMatchStatus?: 'not_imported' | 'matched' | 'divergent' | 'not_applicable';
  esocialEventId?: string | null;
  divergenceSummary?: string | null;
}

export interface AsoAlertEsocialExam {
  workerKey: string | null;
  examDate: string | null;
  examKind: string | null;
  /** `null` quando a periodicidade não é apurável para o tipo de exame. */
  validityDate: string | null;
  eventId?: string | null;
}

export interface AsoAlertWindows {
  /** Dias para o nível `expiring_30`. */
  critical: number;
  /** Dias para o nível `expiring_60`. */
  warning: number;
}

export const DEFAULT_ASO_WINDOWS: AsoAlertWindows = { critical: 30, warning: 60 };

/** Rótulo do aviso que atravessa a seção inteira. Uma frase, um lugar só. */
export const ASO_CONTROL_NOTICE =
  'ASO controlado pelo documento original. Conferência com o eSocial é opcional.';

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

/**
 * Ordem de precedência entre documentos do MESMO colaborador.
 *
 * Um aprovado sempre vence um pendente, mesmo que o pendente seja mais novo: o
 * documento que sustenta o indicador é o que passou por revisão. Dentro do
 * mesmo estado, vale o exame mais recente.
 */
const DOCUMENT_PRECEDENCE: Record<AsoDocumentStatus, number> = {
  approved: 0,
  pending_review: 1,
  needs_correction: 2,
  rejected: 3,
};

function preferDocument(a: AsoAlertDocument | null, b: AsoAlertDocument): AsoAlertDocument {
  if (!a) return b;
  const pa = DOCUMENT_PRECEDENCE[a.documentStatus];
  const pb = DOCUMENT_PRECEDENCE[b.documentStatus];
  if (pa !== pb) return pa < pb ? a : b;
  return laterOf(a, b);
}

export function buildAsoAlerts(input: {
  workers: AsoAlertWorker[];
  documents: AsoAlertDocument[];
  /** Opcional em todos os sentidos: ausente, a fila continua completa. */
  esocialExams?: AsoAlertEsocialExam[];
  reference?: Date;
  windows?: AsoAlertWindows;
}): AsoAlert[] {
  const today = (input.reference ?? new Date()).toISOString().slice(0, 10);
  const windows = input.windows ?? DEFAULT_ASO_WINDOWS;

  const docByWorker = new Map<string, AsoAlertDocument>();
  for (const doc of input.documents) {
    for (const key of documentKeys(doc)) {
      docByWorker.set(key, preferDocument(docByWorker.get(key) ?? null, doc));
    }
  }

  const examByWorker = new Map<string, AsoAlertEsocialExam>();
  for (const exam of input.esocialExams ?? []) {
    if (!exam.workerKey) continue;
    examByWorker.set(exam.workerKey, laterOf(examByWorker.get(exam.workerKey) ?? null, exam));
  }

  const alerts: AsoAlert[] = input.workers.map((worker) => {
    const doc =
      docByWorker.get(worker.workerKey) ??
      (worker.personId ? docByWorker.get(`person:${worker.personId}`) : undefined) ??
      null;
    const exam = examByWorker.get(worker.workerKey) ?? null;

    const esocial = crossCheck(doc, exam);

    const base = {
      workerKey: worker.workerKey,
      personId: worker.personId ?? null,
      name: worker.name,
      areaLabel: worker.areaLabel,
      documentId: doc?.id ?? null,
      esocial,
    };

    // ── Nenhum PDF no acervo ──
    if (!doc) {
      return {
        ...base,
        level: 'no_document' as const,
        source: 'none' as const,
        documentStatus: 'missing' as const,
        examDate: null,
        examKind: null,
        validityDate: null,
        validityBasis: null,
        daysToExpiry: null,
        reason: exam
          ? 'Documento não enviado. Há evento S-2220 no eSocial para este colaborador, mas o ASO original ainda não foi anexado ao acervo — sem ele não há data de validade a controlar.'
          : 'Documento não enviado. Anexe o PDF do ASO para que o vencimento passe a ser controlado.',
      };
    }

    const common = {
      ...base,
      documentStatus: doc.documentStatus,
      examDate: doc.examDate,
      examKind: doc.examKind,
    };

    // ── Há PDF, mas ele ainda não sustenta nada ──
    if (doc.documentStatus === 'pending_review') {
      return {
        ...common,
        level: 'pending_review' as const,
        source: 'none' as const,
        validityDate: null,
        validityBasis: doc.validityBasis,
        daysToExpiry: null,
        reason:
          'ASO enviado e aguardando revisão do RH. Nenhum documento vira controle de vencimento antes de alguém conferir os campos lidos.',
      };
    }

    if (doc.documentStatus === 'rejected' || doc.documentStatus === 'needs_correction') {
      return {
        ...common,
        level: 'needs_correction' as const,
        source: 'none' as const,
        validityDate: null,
        validityBasis: doc.validityBasis,
        daysToExpiry: null,
        reason:
          doc.documentStatus === 'rejected'
            ? 'O ASO enviado foi rejeitado na revisão. O colaborador está sem documento válido no acervo — providencie o atestado correto.'
            : 'O ASO enviado voltou para correção. Ajuste os campos apontados e submeta de novo à revisão.',
      };
    }

    // ── Documento APROVADO ──
    if (!doc.validityDate) {
      return {
        ...common,
        level: 'no_validity' as const,
        source: 'document' as const,
        validityDate: null,
        validityBasis: doc.validityBasis,
        daysToExpiry: null,
        reason:
          'ASO aprovado, mas sem vencimento apurável: o documento não declara validade e o tipo de exame não permite deduzi-la. Não é irregularidade — é uma data que ninguém escreveu.',
      };
    }

    const daysToExpiry = daysBetween(today, doc.validityDate);
    const level: AsoAlertLevel =
      daysToExpiry < 0
        ? 'expired'
        : daysToExpiry <= windows.critical
          ? 'expiring_30'
          : daysToExpiry <= windows.warning
            ? 'expiring_60'
            : 'ok';

    const basisNote =
      doc.validityBasis === 'declared_document'
        ? 'validade declarada no documento'
        : 'validade inferida pela periodicidade do exame';

    const reason =
      level === 'expired'
        ? `ASO vencido há ${Math.abs(daysToExpiry)} dia(s) — ${basisNote}.`
        : level === 'ok'
          ? `Em dia; vence em ${daysToExpiry} dia(s) — ${basisNote}.`
          : `Vence em ${daysToExpiry} dia(s) — ${basisNote}.`;

    return {
      ...common,
      level,
      source: 'document' as const,
      validityDate: doc.validityDate,
      validityBasis: doc.validityBasis,
      daysToExpiry,
      reason,
    };
  });

  // Fila de trabalho: o que exige ação primeiro, e dentro disso o que vence antes.
  const order: Record<AsoAlertLevel, number> = {
    expired: 0,
    expiring_30: 1,
    no_document: 2,
    needs_correction: 3,
    pending_review: 4,
    expiring_60: 5,
    no_validity: 6,
    ok: 7,
  };
  return alerts.sort((a, b) => {
    if (order[a.level] !== order[b.level]) return order[a.level] - order[b.level];
    if (a.daysToExpiry !== null && b.daysToExpiry !== null) return a.daysToExpiry - b.daysToExpiry;
    return (a.name ?? '').localeCompare(b.name ?? '', 'pt-BR');
  });
}

/** Chaves pelas quais um documento pode alcançar um trabalhador. */
function documentKeys(doc: AsoAlertDocument): string[] {
  const keys: string[] = [];
  if (doc.workerKey) keys.push(doc.workerKey);
  if (doc.personId) keys.push(`person:${doc.personId}`);
  return keys;
}

/**
 * Colaboradores que só existem no acervo de ASOs.
 *
 * Um PDF enviado antes de a pessoa entrar no cadastro — ou de qualquer
 * importação acontecer — não pode simplesmente sumir da fila. Sem isto, uma
 * organização que ainda não cadastrou ninguém veria a tela vazia depois de
 * subir cinquenta atestados, e concluiria que o upload não funcionou.
 *
 * A linha sintetizada carrega o nome como saiu do papel e nenhuma lotação: é
 * um documento à procura de dono, e a tela precisa dizer isso em vez de fingir
 * que há um vínculo.
 */
export function workersFromUnmatchedDocuments(
  documents: AsoAlertDocument[],
  known: AsoAlertWorker[],
  nameOf: (doc: AsoAlertDocument) => string | null = () => null,
): AsoAlertWorker[] {
  const covered = new Set<string>();
  for (const worker of known) {
    covered.add(worker.workerKey);
    if (worker.personId) covered.add(`person:${worker.personId}`);
  }

  const extra = new Map<string, AsoAlertWorker>();
  for (const doc of documents) {
    const keys = documentKeys(doc);
    if (keys.length === 0) {
      // Documento sem chave nenhuma: entra pela própria identidade, para poder
      // ser revisado e vinculado à mão.
      extra.set(`document:${doc.id}`, {
        workerKey: `document:${doc.id}`,
        personId: null,
        name: nameOf(doc),
        areaLabel: null,
      });
      continue;
    }
    if (keys.some((k) => covered.has(k))) continue;
    const key = keys[0];
    if (extra.has(key)) continue;
    extra.set(key, {
      workerKey: key,
      personId: doc.personId ?? null,
      name: nameOf(doc),
      areaLabel: null,
    });
  }
  return [...extra.values()];
}

/**
 * Monta a conferência com o eSocial.
 *
 * Preserva o que a rota já apurou no documento (`esocialMatchStatus`) e
 * completa com os fatos do evento quando eles existem. Se não há evento, o
 * estado é `not_imported` — neutro, e nunca um problema do documento.
 */
function crossCheck(
  doc: AsoAlertDocument | null,
  exam: AsoAlertEsocialExam | null,
): AsoEsocialCrossCheck {
  const hasEsocial = Boolean(exam || doc?.esocialEventId);
  return {
    eventId: doc?.esocialEventId ?? exam?.eventId ?? null,
    examDate: exam?.examDate ?? null,
    examKind: exam?.examKind ?? null,
    validityDate: exam?.validityDate ?? null,
    status: hasEsocial ? (doc?.esocialMatchStatus ?? 'not_applicable') : 'not_imported',
    summary: doc?.divergenceSummary ?? null,
  };
}

export interface AsoAlertSummary {
  expired: number;
  expiring30: number;
  expiring60: number;
  ok: number;
  noValidity: number;
  pendingReview: number;
  needsCorrection: number;
  noDocument: number;
  /** Quantos exigem ação do RH agora. */
  actionable: number;
  /** Divergências com o S-2220 — aviso paralelo, fora da fila de urgência. */
  esocialDivergent: number;
  total: number;
}

const LEVEL_TO_SUMMARY_KEY: Record<AsoAlertLevel, keyof AsoAlertSummary> = {
  expired: 'expired',
  expiring_30: 'expiring30',
  expiring_60: 'expiring60',
  ok: 'ok',
  no_validity: 'noValidity',
  pending_review: 'pendingReview',
  needs_correction: 'needsCorrection',
  no_document: 'noDocument',
};

export function summarizeAsoAlerts(alerts: AsoAlert[]): AsoAlertSummary {
  const summary: AsoAlertSummary = {
    expired: 0, expiring30: 0, expiring60: 0, ok: 0, noValidity: 0,
    pendingReview: 0, needsCorrection: 0, noDocument: 0,
    actionable: 0, esocialDivergent: 0, total: alerts.length,
  };
  for (const a of alerts) {
    summary[LEVEL_TO_SUMMARY_KEY[a.level]] += 1;
    if (a.esocial.status === 'divergent') summary.esocialDivergent += 1;
  }
  // "Sem vencimento apurável" e "em dia" ficam de fora: o primeiro é lacuna do
  // papel, não pendência de alguém, e agir sobre ele é conferir, não corrigir.
  summary.actionable =
    summary.expired + summary.expiring30 + summary.noDocument +
    summary.needsCorrection + summary.pendingReview;
  return summary;
}

/** Assunto e corpo do digest enviado ao RH. */
export function buildAsoDigest(alerts: AsoAlert[], windows: AsoAlertWindows = DEFAULT_ASO_WINDOWS): {
  subject: string;
  html: string;
  text: string;
} {
  const summary = summarizeAsoAlerts(alerts);
  const urgent = alerts.filter((a) => a.level === 'expired' || a.level === 'expiring_30');

  const subject =
    summary.expired > 0
      ? `[SST] ${summary.expired} ASO(s) vencido(s) e ${summary.expiring30} a vencer em ${windows.critical} dias`
      : `[SST] ${summary.expiring30} ASO(s) a vencer em até ${windows.critical} dias`;

  const rows = urgent
    .map(
      (a) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(a.name ?? 'Identificação restrita')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(a.areaLabel ?? '—')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${a.validityDate ?? '—'}</td>
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
        ${summary.expired} vencido(s) · ${summary.expiring30} vence(m) em até ${windows.critical} dias ·
        ${summary.expiring60} em até ${windows.warning} dias · ${summary.noDocument} sem documento enviado ·
        ${summary.pendingReview} aguardando revisão · ${summary.noValidity} sem vencimento apurável
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
        ${summary.noDocument} colaborador(es) estão com o <strong>documento não enviado</strong> e
        ${summary.noValidity} com exame sem vencimento apurável. Nenhum dos dois é irregularidade:
        são pendências de acervo e de leitura, respectivamente.
        ${summary.esocialDivergent > 0
          ? `${summary.esocialDivergent} documento(s) divergem do S-2220 transmitido — a conferência com o eSocial é opcional e não invalida o papel.`
          : ''}
      </p>
      <p style="margin-top:8px;font-size:11px;color:#9ca3af">${ASO_CONTROL_NOTICE}</p>
    </div>`;

  const text = [
    'Saúde ocupacional — ASOs a vencer',
    `${summary.expired} vencido(s), ${summary.expiring30} em até ${windows.critical} dias, ${summary.noDocument} sem documento enviado.`,
    '',
    ...urgent.map(
      (a) =>
        `- ${a.name ?? 'Identificação restrita'} (${a.areaLabel ?? '—'}): ${a.validityDate ?? '—'} — ${a.reason}`,
    ),
    '',
    ASO_CONTROL_NOTICE,
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
