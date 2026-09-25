/**
 * DECISÕES — o TEXTO dos avisos (in-app, e-mail, WhatsApp). Código puro.
 *
 * Um aviso é um PONTEIRO para a decisão, nunca a decisão: nenhum canal
 * aprova nada, e todo texto leva ao Apex, onde o ato acontece com a sessão da
 * pessoa. Por isso não há botão "aprovar" no e-mail nem link mágico no
 * WhatsApp — e o e-mail diz isso com todas as letras.
 *
 * Tudo que entra aqui veio do banco (decision_resolve, prazo derivado, nomes
 * resolvidos na organização da decisão). Nenhum valor é estimado; campo sem
 * dado some da mensagem, em vez de virar "—" ou chute.
 *
 * Todo valor dinâmico é escapado no HTML — inclusive a URL dentro de
 * atributo, que no modelo antigo da agenda entrava crua.
 */
import { CANONICAL_PRODUCTION_ORIGIN } from '@/lib/config/app-url';

export type NoticeKind = 'NEW' | 'DUE_SOON' | 'OVERDUE' | 'ESCALATED' | 'RESOLVED' | 'ADJUSTMENT_REQUESTED';
export type NoticeOutcome = 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export interface NoticeContext {
  kind: NoticeKind;
  outcome: NoticeOutcome | null;
  title: string;                 // "Pedido de compra OC-…"
  kindLabel: string;             // "Compra"
  amount: number | null;
  currency: string | null;
  projectName: string | null;
  supplierName: string | null;
  needBy: string | null;         // YYYY-MM-DD — necessidade do material (requisito do projeto)
  decideBy: string | null;       // YYYY-MM-DD — último dia em que aprovar ainda chega a tempo
  today: string;                 // YYYY-MM-DD, no fuso da organização
  reason: string | null;         // justificativa do desfecho / do ajuste (só e-mail e in-app)
  deciderName: string | null;
  requesterName: string | null;
  link: string;                  // RELATIVO ao Apex (/decisoes?d=…)
  appOrigin: string;             // getPublicAppOrigin()
}

/** Avisos que pedem um ato. Os outros informam um desfecho. */
export const ACTION_NOTICE_KINDS: ReadonlySet<NoticeKind> = new Set(['NEW', 'DUE_SOON', 'OVERDUE', 'ESCALATED']);

export const EMAIL_DISCLAIMER = 'Este e-mail não é uma aprovação: a decisão acontece no Apex, com a sua sessão.';
export const BRAND_ACCENT = '#0F766E';

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

/** "R$ 182.400" (inteiro, sem centavos) | "R$ 182.400,50". Espaço comum, não o NBSP do Intl. */
export function formatNoticeMoney(amount: number | null, currency: string | null): string | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'BRL';
  const digits = Number.isInteger(amount) ? 0 : 2;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amount).replace(/[  ]/g, ' ');
}

/** "2026-09-29" → "29/09/2026". Data inválida some. */
export function formatNoticeDate(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function daysFrom(today: string, iso: string | null): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  return Math.round((Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Uma linha de texto: sem controle, sem quebra, com teto. Nome de projeto não é lugar de parágrafo. */
function inline(value: string | null | undefined, max = 160): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** O link RELATIVO que pode ir para a notificação (a 240 recusa absoluto e `//`). */
export function relativeNoticeLink(link: string | null | undefined): string {
  const l = typeof link === 'string' ? link.trim() : '';
  return l.startsWith('/') && !l.startsWith('//') && !l.includes('\\') && !/[\u0000-\u001f\s]/.test(l) ? l : '/decisoes';
}

/**
 * O link ABSOLUTO (e-mail, WhatsApp): sempre http(s), sempre na origem do
 * Apex. Um link que tente sair da origem vira a caixa de Decisões.
 */
export function absoluteNoticeLink(link: string | null | undefined, appOrigin: string | null | undefined): string {
  let origin: URL;
  try { origin = new URL(appOrigin || CANONICAL_PRODUCTION_ORIGIN); } catch { origin = new URL(CANONICAL_PRODUCTION_ORIGIN); }
  if (origin.protocol !== 'https:' && origin.protocol !== 'http:') origin = new URL(CANONICAL_PRODUCTION_ORIGIN);
  const url = new URL(relativeNoticeLink(link), origin.origin);
  return url.origin === origin.origin ? url.toString() : `${origin.origin}/decisoes`;
}

// ---------------------------------------------------------------------------
// Frases
// ---------------------------------------------------------------------------

export function noticeHeadline(kind: NoticeKind, outcome: NoticeOutcome | null): string {
  switch (kind) {
    case 'NEW': return 'Decisão necessária';
    case 'DUE_SOON': return 'Prazo próximo';
    case 'OVERDUE': return 'Decisão vencida';
    case 'ESCALATED': return 'Decisão escalada para você';
    case 'ADJUSTMENT_REQUESTED': return 'Ajuste solicitado';
    case 'RESOLVED':
      if (outcome === 'APPROVED') return 'Sua solicitação foi aprovada';
      if (outcome === 'REJECTED') return 'Sua solicitação foi rejeitada';
      if (outcome === 'EXPIRED') return 'Sua solicitação expirou sem decisão';
      return 'Sua solicitação foi cancelada';
  }
}

/** "Compra de R$ 182.400" | "Liberação de faturamento". */
function kindWithAmount(ctx: NoticeContext): string {
  const kind = inline(ctx.kindLabel, 60) ?? 'Decisão';
  const money = formatNoticeMoney(ctx.amount, ctx.currency);
  return money ? `${kind} de ${money}` : kind;
}

/** "Decisão necessária — Compra de R$ 182.400". */
export function noticeSubject(ctx: NoticeContext): string {
  return `${noticeHeadline(ctx.kind, ctx.outcome)} — ${kindWithAmount(ctx)}`;
}

/** "Material necessário em 5 dias." — só com necessidade vinculada; nada é estimado. */
export function needLine(ctx: Pick<NoticeContext, 'needBy' | 'today'>): string | null {
  const d = daysFrom(ctx.today, ctx.needBy);
  if (d === null) return null;
  if (d > 1) return `Material necessário em ${d} dias.`;
  if (d === 1) return 'Material necessário amanhã.';
  if (d === 0) return 'Material necessário hoje.';
  return `A necessidade do material passou há ${plural(-d, 'dia', 'dias')}.`;
}

/** O prazo de DECIDIR, nos avisos que existem por causa dele. */
function deadlineLine(ctx: NoticeContext): string | null {
  const date = formatNoticeDate(ctx.decideBy);
  if (!date) return null;
  if (ctx.kind === 'DUE_SOON') return `Decidir até ${date}.`;
  if (ctx.kind === 'OVERDUE' || ctx.kind === 'ESCALATED') return `O prazo para decidir venceu em ${date}.`;
  return null;
}

const NEEDS_APPROVAL: Record<string, string> = {
  Compra: 'A compra exige sua aprovação.',
  'Liberação de faturamento': 'A liberação de faturamento exige sua aprovação.',
};

/** O "Motivo" do e-mail: por que ESTE aviso chegou a ESTA pessoa. */
function motive(ctx: NoticeContext): string | null {
  const reason = inline(ctx.reason, 600);
  switch (ctx.kind) {
    case 'NEW': return NEEDS_APPROVAL[ctx.kindLabel] ?? 'Esta solicitação exige sua aprovação.';
    case 'DUE_SOON': return 'O prazo para decidir está próximo.';
    case 'OVERDUE': return 'O prazo para decidir venceu e a decisão continua com você.';
    case 'ESCALATED': return 'O prazo da faixa de alçada primária venceu e a decisão chegou à sua faixa.';
    case 'ADJUSTMENT_REQUESTED': return reason ?? 'Ajuste solicitado sem justificativa registrada.';
    case 'RESOLVED':
      if (ctx.outcome === 'EXPIRED') return 'O prazo terminou sem decisão.';
      return reason;
  }
}

// ---------------------------------------------------------------------------
// Canais
// ---------------------------------------------------------------------------

export interface InAppNotice { title: string; body: string; link: string }
export interface EmailNotice { subject: string; html: string; text: string }

/** A notificação do sino: ponteiro relativo, corpo curto. */
export function inAppNotice(ctx: NoticeContext): InAppNotice {
  const parts: string[] = [];
  const title = inline(ctx.title, 120);
  if (title) parts.push(title);
  const project = inline(ctx.projectName, 80);
  if (project) parts.push(`Projeto ${project}`);
  const supplier = inline(ctx.supplierName, 80);
  if (supplier) parts.push(`Fornecedor ${supplier}`);
  if (ACTION_NOTICE_KINDS.has(ctx.kind)) {
    const due = deadlineLine(ctx) ?? needLine(ctx);
    if (due) parts.push(due.replace(/\.$/, ''));
  } else {
    const decider = inline(ctx.deciderName, 80);
    if (decider) parts.push(`${ctx.kind === 'ADJUSTMENT_REQUESTED' ? 'Solicitado' : 'Decidido'} por ${decider}`);
    const m = ctx.kind === 'ADJUSTMENT_REQUESTED' || ctx.outcome === 'REJECTED' ? inline(ctx.reason, 280) : null;
    if (m) parts.push(`Motivo: ${m}`);
  }
  return {
    title: noticeSubject(ctx).slice(0, 200),
    body: parts.join(' · ').slice(0, 600),
    link: relativeNoticeLink(ctx.link),
  };
}

/** Linhas do cartão do e-mail, na ordem do produto. Sem dado, sem linha. */
function emailRows(ctx: NoticeContext): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Projeto', inline(ctx.projectName, 120)],
    ['Fornecedor', inline(ctx.supplierName, 120)],
    ['Necessário até', formatNoticeDate(ctx.needBy)],
  ];
  if (ctx.kind === 'DUE_SOON' || ctx.kind === 'OVERDUE' || ctx.kind === 'ESCALATED') rows.push(['Decidir até', formatNoticeDate(ctx.decideBy)]);
  if (!ACTION_NOTICE_KINDS.has(ctx.kind)) {
    rows.push([ctx.kind === 'ADJUSTMENT_REQUESTED' ? 'Solicitado por' : 'Decidido por', inline(ctx.deciderName, 120)]);
  }
  rows.push(['Motivo', motive(ctx)]);
  return rows.filter((r): r is [string, string] => !!r[1]);
}

export function emailNotice(ctx: NoticeContext): EmailNotice {
  const subject = noticeSubject(ctx);
  const headline = noticeHeadline(ctx.kind, ctx.outcome);
  const summary = [kindWithAmount(ctx), inline(ctx.title, 120)].filter(Boolean).join(' · ');
  const rows = emailRows(ctx);
  const url = absoluteNoticeLink(ctx.link, ctx.appOrigin);
  const cta = ACTION_NOTICE_KINDS.has(ctx.kind) ? 'Analisar no Apex' : 'Ver no Apex';
  const extra = [needLine(ctx)].filter((x): x is string => ACTION_NOTICE_KINDS.has(ctx.kind) && !!x);

  const text = [
    subject,
    inline(ctx.title, 120) ?? '',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(extra.length ? ['', ...extra] : []),
    '',
    `${cta}: ${url}`,
    '',
    EMAIL_DISCLAIMER,
  ].join('\n');

  const e = escapeHtml;
  const font = 'font-family:Arial,Helvetica,sans-serif;';
  const rowHtml = rows.map(([k, v]) => [
    '<tr>',
    `<td valign="top" style="${font}padding:9px 12px 9px 0;border-top:1px solid #e5ebe9;font-size:13px;line-height:1.45;color:#5b6b66;width:132px;">${e(k)}</td>`,
    `<td valign="top" style="${font}padding:9px 0;border-top:1px solid #e5ebe9;font-size:14px;line-height:1.45;color:#111827;font-weight:600;">${e(v)}</td>`,
    '</tr>',
  ].join('')).join('');

  const html = [
    '<!DOCTYPE html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">',
    `<title>${e(subject)}</title></head>`,
    '<body style="margin:0;padding:0;background-color:#eef2f1;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef2f1" style="background-color:#eef2f1;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dbe3e0;border-radius:8px;">',
    `<tr><td bgcolor="${BRAND_ACCENT}" style="${font}background-color:${BRAND_ACCENT};padding:12px 24px;border-radius:8px 8px 0 0;font-size:12px;font-weight:700;letter-spacing:1px;color:#ffffff;">INSIGHT APEX</td></tr>`,
    `<tr><td bgcolor="#ffffff" style="${font}background-color:#ffffff;padding:22px 24px 6px;">`,
    `<h1 style="${font}margin:0 0 6px;font-size:20px;line-height:1.3;color:#111827;">${e(headline)}</h1>`,
    `<p style="${font}margin:0;font-size:14px;line-height:1.5;color:#374151;">${e(summary)}</p>`,
    '</td></tr>',
    rows.length
      ? `<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:10px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rowHtml}</table></td></tr>`
      : '',
    extra.length
      ? `<tr><td bgcolor="#ffffff" style="${font}background-color:#ffffff;padding:12px 24px 0;font-size:14px;line-height:1.5;color:${BRAND_ACCENT};font-weight:600;">${extra.map(e).join('<br>')}</td></tr>`
      : '',
    '<tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 24px 22px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td bgcolor="${BRAND_ACCENT}" style="background-color:${BRAND_ACCENT};border-radius:6px;">`,
    `<a href="${e(url)}" target="_blank" rel="noopener noreferrer" style="${font}display:inline-block;padding:12px 20px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${e(cta)}</a>`,
    '</td></tr></table>',
    `<p style="${font}margin:12px 0 0;font-size:12px;line-height:1.5;color:#5b6b66;word-break:break-all;">Se o botão não abrir, copie: ${e(url)}</p>`,
    '</td></tr>',
    `<tr><td bgcolor="#f7f9f8" style="${font}background-color:#f7f9f8;padding:14px 24px;border-top:1px solid #e5ebe9;border-radius:0 0 8px 8px;font-size:12px;line-height:1.5;color:#5b6b66;">${e(EMAIL_DISCLAIMER)}</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('');

  return { subject, html, text };
}

/** Texto de WhatsApp: uma linha, sem marcação do app (*negrito*, _itálico_, ~riscado~, `código`). */
function wa(value: string | null | undefined, max = 80): string | null {
  const t = inline(value, max);
  return t ? t.replace(/[*_~`]/g, '').trim() || null : null;
}

/**
 * WhatsApp. MINIMAL: tipo, projeto, dias até a necessidade, link — sem valor,
 * sem fornecedor. Em NENHUM nível vai justificativa, motivo ou e-mail: o
 * WhatsApp fica no celular, na tela de bloqueio, no backup de terceiros.
 */
export function whatsAppNotice(ctx: NoticeContext, level: 'MINIMAL' | 'STANDARD'): string {
  const kind = wa(ctx.kindLabel, 60) ?? 'Decisão';
  const project = wa(ctx.projectName);
  const lines = ['Insight Apex', '', noticeHeadline(ctx.kind, ctx.outcome), ''];
  if (level === 'STANDARD') {
    const money = formatNoticeMoney(ctx.amount, ctx.currency);
    lines.push(money ? `${kind}: ${money}` : kind);
    if (project) lines.push(`Projeto: ${project}`);
    const supplier = wa(ctx.supplierName);
    if (supplier) lines.push(`Fornecedor: ${supplier}`);
  } else {
    lines.push(kind);
    if (project) lines.push(`Projeto: ${project}`);
  }
  const timing = ACTION_NOTICE_KINDS.has(ctx.kind) ? [needLine(ctx), deadlineLine(ctx)].filter((x): x is string => !!x) : [];
  if (timing.length) lines.push('', ...timing);
  lines.push('', ACTION_NOTICE_KINDS.has(ctx.kind) ? 'Analisar:' : 'Ver no Apex:', absoluteNoticeLink(ctx.link, ctx.appOrigin));
  return lines.join('\n');
}
