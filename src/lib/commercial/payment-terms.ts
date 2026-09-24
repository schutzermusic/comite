/**
 * CONDIÇÃO DE PAGAMENTO — de parágrafo a parcelas.
 *
 * O documento escreve "10% na mobilização; 20% no Marco 1; …; saldo em até
 * 45 dias após a fatura". A tela precisa de linhas: percentual, valor,
 * gatilho/marco e prazo/condição. Este parser é determinístico e
 * conservador: o que ele não reconhece vira "condição geral", nunca some, e
 * o texto original continua disponível como proveniência.
 *
 * Nada aqui inventa: valor só é calculado quando há percentual E total da
 * revisão; valor escrito no documento prevalece sobre o calculado.
 */

export interface PaymentInstallment {
  percent: number | null;
  amount: number | null;
  /** O valor foi calculado (percentual × total), não lido. */
  amountDerived: boolean;
  trigger: string;
  condition: string | null;
  source: string;
}

export interface StructuredPaymentTerms {
  installments: PaymentInstallment[];
  /** Condições sem percentual — prazo final, retenção, forma de pagamento. */
  general: string[];
  percentTotal: number | null;
  /** Os percentuais somam 100%? Nulo quando não há percentuais. */
  complete: boolean | null;
  original: string;
}

const PERCENT = /(\d{1,3}(?:[.,]\d{1,2})?)\s*%/;
const MONEY = /R\$\s*([\d.]+(?:,\d{1,2})?)/i;
const DEADLINE = /((?:em\s+)?at[eé]\s+\d{1,3}\s*(?:\([^)]*\)\s*)?dias?[^;.]*|\d{1,3}\s*(?:\([^)]*\)\s*)?dias?\s+(?:ap[oó]s|contados?|da|do|a partir)[^;.]*|(?:DDL|DFM|DDF)\s*\d+|\d+\s*DDL)/i;

const parseBRNumber = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** Quebra o texto nas unidades que o documento usou. */
export function splitClauses(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+|;\s*|(?<=[a-zà-ú)]\.)\s+(?=[A-ZÁÉÍÓÚ0-9])|\s+[•·▪◦]\s+|^[•·▪◦-]\s+|(?<=\.)\s+(?=\d{1,3}(?:[.,]\d+)?\s*%)|\s+(?=\(?[a-z]\)\s)|\s+(?=\d{1,2}[.)]\s+\d{1,3}\s*%)/gim)
    .map((s) => s.replace(/^\s*(?:[-•·▪◦]|\(?[a-z0-9]{1,2}[.)])\s*/i, '').trim().replace(/[.;,]+$/, ''))
    .filter((s) => s.length > 1);
}

function cleanTrigger(s: string): string {
  const t = s
    .replace(/^[^%:]{2,40}:\s*(?=\d)/, '')
    .replace(PERCENT, '')
    .replace(/^\s*\([^)]*\)/, '')
    .replace(MONEY, '')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s,:–—-]*(?:do valor(?: total)?(?: do contrato| da proposta)?|sobre o valor[^,]*)?[\s,:–—-]*/i, '')
    .replace(/^(?:na|no|nas|nos|ap[oó]s a|ap[oó]s o|contra|mediante|quando da|por ocasi[aã]o d[aoe])\s+/i, (m) => m.trim().toLowerCase() === 'contra' ? 'Contra ' : '')
    .replace(/^em\s+/i, '')
    .replace(/[,\s]*(?:com pagamento|pagamento|a ser pag[oa]s?|pag[oa]s?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,:–—-]+|[\s,:–—-]+$/g, '')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

export function structurePaymentTerms(text: string | null | undefined, total?: number | string | null): StructuredPaymentTerms {
  const original = (text ?? '').trim();
  const totalN = total === null || total === undefined || total === '' ? null : Number(total);
  const installments: PaymentInstallment[] = [];
  const general: string[] = [];
  if (!original) return { installments, general, percentTotal: null, complete: null, original };

  for (const clause of splitClauses(original)) {
    const pct = clause.match(PERCENT);
    if (!pct) { general.push(clause); continue; }
    const percent = Number(pct[1].replace(',', '.'));
    const money = clause.match(MONEY);
    const deadline = clause.match(DEADLINE);
    const read = money ? parseBRNumber(money[1]) : null;
    const amount = read ?? (totalN !== null && Number.isFinite(totalN) ? Math.round(totalN * percent) / 100 : null);
    let rest = clause;
    if (deadline) rest = rest.replace(deadline[0], ' ');
    installments.push({
      percent,
      amount,
      amountDerived: read === null && amount !== null,
      trigger: cleanTrigger(rest) || (installments.length === 0 ? 'Entrada' : `Parcela ${installments.length + 1}`),
      condition: deadline ? deadline[0].replace(/^em\s+/i, '').trim().replace(/^./, (c) => c.toUpperCase()) : null,
      source: clause,
    });
  }
  const percentTotal = installments.length
    ? Math.round(installments.reduce((n, i) => n + (i.percent ?? 0), 0) * 100) / 100 : null;
  return { installments, general, percentTotal,
    complete: percentTotal === null ? null : Math.abs(percentTotal - 100) < 0.01, original };
}

/** Uma linha: "10% mobilização · 20% Marco 1 · … · até 45 dias". */
export function paymentSummary(terms: StructuredPaymentTerms): string {
  if (!terms.original) return 'Não declarada';
  if (!terms.installments.length) return terms.general[0] ?? terms.original.slice(0, 120);
  const n = terms.installments.length;
  const deadline = [...terms.installments.map((i) => i.condition), ...terms.general]
    .map((t) => t?.match(/(?:at[eé]\s+)?\d{1,3}\s*dias?/i)?.[0]).find(Boolean);
  return `${n} parcela${n > 1 ? 's' : ''}${terms.complete === false ? ` · soma ${terms.percentTotal}%` : ''}${deadline ? ` · ${deadline.toLowerCase()}` : ''}`;
}

/**
 * Escopo/descrição longa em itens legíveis. Respeita as quebras e marcadores
 * do documento; frases longas sem marcador viram itens por sentença.
 */
export function chunkText(text: string | null | undefined, max = 12): { items: string[]; more: number } {
  const raw = (text ?? '').trim();
  if (!raw) return { items: [], more: 0 };
  let items = raw.split(/\n+|;\s+|\s+[•·▪◦]\s+|(?:^|\s)(?=\d{1,2}[.)]\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/g)
    .map((s) => s.replace(/^\s*(?:[-•·▪◦]|\d{1,2}[.)])\s*/, '').trim().replace(/[;,]+$/, ''))
    .filter((s) => s.length > 1);
  if (items.length === 1 && items[0].length > 220) {
    items = items[0].split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/).map((s) => s.trim()).filter(Boolean);
  }
  return { items: items.slice(0, max), more: Math.max(0, items.length - max) };
}
