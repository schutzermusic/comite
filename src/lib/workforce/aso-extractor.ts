/**
 * Leitura de um ASO em PDF.
 *
 * Camada pura: recebe o texto já extraído do PDF e devolve os campos, com o
 * que NÃO conseguiu ler declarado item a item. Sem I/O, para que o
 * comportamento com atestados reais seja exercitável em teste — é o mesmo
 * desenho do parser de cronograma do MS Project.
 *
 * O QUE ESTE MÓDULO RESOLVE
 *
 * O S-2220 não declara validade. O ASO impresso quase sempre declara ("Válido
 * até", "Próximo exame em"). Ler o papel troca uma inferência nossa por um
 * fato do documento — e é essa troca que faz "ASO vencido" deixar de ser uma
 * suposição e virar uma afirmação defensável numa fiscalização.
 *
 * REGRA QUE ATRAVESSA TUDO: campo ilegível vira `undefined` mais uma issue
 * declarada. Nunca um chute. Um ASO com data de validade inventada é pior que
 * um ASO sem data, porque o segundo pede conferência e o primeiro não.
 */

/** Domínio do `tpExameOcup` do eSocial — o mesmo, para poder comparar. */
export type AsoExamKind = '0' | '1' | '2' | '3' | '4' | '9';

export type AsoValidityBasis = 'declared_document' | 'inferred_periodicity' | 'undetermined';

export interface AsoExtractionIssue {
  field: string;
  reason: string;
}

export interface AsoExtraction {
  examDate?: string;
  examKind?: AsoExamKind;
  /** '1' apto | '2' inapto — mesmo domínio do `resAso`. */
  result?: '1' | '2';
  validUntil?: string;
  validityBasis: AsoValidityBasis;
  doctorName?: string;
  doctorCrm?: string;
  workerName?: string;
  cpf?: string;
  companyName?: string;
  /** 0..1 — quanto do que importa foi lido. */
  confidence: number;
  issues: AsoExtractionIssue[];
}

/** Rótulos impressos → domínio do eSocial. Ordem importa: o mais específico primeiro. */
const EXAM_KIND_PATTERNS: { re: RegExp; kind: AsoExamKind }[] = [
  { re: /mudan[çc]a\s+de\s+(risco|fun[çc][ãa]o)/i, kind: '3' },
  { re: /retorno\s+ao\s+trabalho/i, kind: '2' },
  { re: /demissional|rescis[óo]rio/i, kind: '9' },
  { re: /admissional/i, kind: '0' },
  { re: /peri[óo]dico/i, kind: '1' },
  { re: /monitora[çc][ãa]o\s+pontual/i, kind: '4' },
];

export const ASO_KIND_FROM_DOCUMENT_LABEL: Record<AsoExamKind, string> = {
  '0': 'Admissional',
  '1': 'Periódico',
  '2': 'Retorno ao trabalho',
  '3': 'Mudança de risco/função',
  '4': 'Monitoração pontual',
  '9': 'Demissional',
};

/** Periodicidade assumida quando o documento NÃO declara validade. */
const INFERRED_PERIOD_MONTHS: Partial<Record<AsoExamKind, number>> = { '1': 12 };

/** Converte dd/mm/aaaa (ou dd-mm-aaaa) para ISO. Ano de 2 dígitos → 20xx. */
export function parsePtBrDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Data impossível (31/02) é dado ruim, não data a corrigir em silêncio.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

const MONTH_NAMES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** "12 de março de 2026" — formato comum no rodapé de assinatura do ASO. */
function parseLongPtBrDate(text: string): string | undefined {
  const m = text.match(/(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i);
  if (!m) return undefined;
  const idx = MONTH_NAMES.findIndex((n) => n === m[2].toLowerCase());
  if (idx < 0) return undefined;
  return parsePtBrDate(`${m[1]}/${idx + 1}/${m[3]}`);
}

/** Normaliza espaços e quebras para que os rótulos sobrevivam ao layout do PDF. */
export function normalizeAsoText(raw: string): string {
  return raw
    .replace(/\r/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Procura uma data logo após qualquer um dos rótulos.
 *
 * A busca é feita numa janela curta depois do rótulo (80 caracteres) porque o
 * PDF quebra a linha entre o rótulo e o valor com frequência — e uma busca
 * larga acabaria pegando a data do rótulo seguinte.
 */
function dateAfterLabel(text: string, labels: RegExp[]): string | undefined {
  for (const label of labels) {
    const match = label.exec(text);
    if (!match) continue;
    const window = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    const iso = parsePtBrDate(window) ?? parseLongPtBrDate(window);
    if (iso) return iso;
  }
  return undefined;
}

const LABELS = {
  examDate: [
    /data\s+d[oa]\s+exame\s*(?:cl[íi]nico)?\s*:?/i,
    /data\s+d[oa]\s+aso\s*:?/i,
    /realizado\s+em\s*:?/i,
    /data\s+d[oa]\s+avalia[çc][ãa]o\s*:?/i,
  ],
  validUntil: [
    /v[áa]lid[oa]\s+at[ée]\s*:?/i,
    /validade\s*(?:do\s+aso)?\s*:?/i,
    /vencimento\s*:?/i,
    /pr[óo]xim[oa]\s+exame\s*(?:em|:)?\s*:?/i,
    /data\s+d[oa]\s+pr[óo]xim[oa]\s+exame\s*:?/i,
  ],
};

/**
 * Interpreta o texto de um ASO.
 *
 * `today` é injetável para teste — a coerência entre data do exame e validade
 * é checada contra ele.
 */
export function extractAso(rawText: string, today: Date = new Date()): AsoExtraction {
  const text = normalizeAsoText(rawText);
  const issues: AsoExtractionIssue[] = [];

  // ── Tipo de exame ──
  let examKind: AsoExamKind | undefined;
  for (const { re, kind } of EXAM_KIND_PATTERNS) {
    if (re.test(text)) {
      examKind = kind;
      break;
    }
  }
  if (!examKind) {
    issues.push({ field: 'examKind', reason: 'Tipo de exame não identificado no documento.' });
  }

  // ── Resultado ──
  // "inapto" primeiro: "apto" é substring de "inapto" e a ordem inversa
  // classificaria todo laudo negativo como positivo.
  let result: '1' | '2' | undefined;
  if (/\binapto\b/i.test(text)) result = '2';
  else if (/\bapto\b/i.test(text)) result = '1';
  else issues.push({ field: 'result', reason: 'Resultado (apto/inapto) não encontrado.' });

  // ── Datas ──
  let examDate = dateAfterLabel(text, LABELS.examDate);
  const declaredValidUntil = dateAfterLabel(text, LABELS.validUntil);

  if (!examDate) {
    // Último recurso: a data por extenso do fecho ("São Paulo, 12 de março de
    // 2026"). Só vale quando não há nada rotulado, e fica registrada como
    // suposição para que a revisão humana olhe.
    const fallback = parseLongPtBrDate(text);
    if (fallback) {
      examDate = fallback;
      issues.push({
        field: 'examDate',
        reason: 'Data do exame não estava rotulada; usada a data por extenso do documento.',
      });
    } else {
      issues.push({ field: 'examDate', reason: 'Data do exame não encontrada.' });
    }
  }

  // ── Validade: declarada > inferida > ausente ──
  let validUntil = declaredValidUntil;
  let validityBasis: AsoValidityBasis = declaredValidUntil ? 'declared_document' : 'undetermined';

  // Validade anterior ao exame é leitura errada de campo, não um ASO vencido
  // na origem. Descartar é mais seguro que publicar a inversão.
  if (validUntil && examDate && validUntil < examDate) {
    issues.push({
      field: 'validUntil',
      reason: `Validade lida (${validUntil}) é anterior à data do exame (${examDate}) — descartada.`,
    });
    validUntil = undefined;
    validityBasis = 'undetermined';
  }

  if (!validUntil && examDate && examKind) {
    const months = INFERRED_PERIOD_MONTHS[examKind];
    if (months) {
      validUntil = addMonths(examDate, months);
      validityBasis = 'inferred_periodicity';
      issues.push({
        field: 'validUntil',
        reason: 'Validade não declarada no documento; inferida pela periodicidade anual da NR-7 para exame periódico.',
      });
    } else {
      issues.push({
        field: 'validUntil',
        reason: `Validade não declarada e não inferível para exame ${ASO_KIND_FROM_DOCUMENT_LABEL[examKind].toLowerCase()}.`,
      });
    }
  }

  // ── Médico ──
  const crmMatch = text.match(/crm\s*[:\-/]?\s*(?:[A-Z]{2}\s*[:\-]?\s*)?(\d{4,7})/i);
  const doctorCrm = crmMatch?.[1];
  const doctorMatch = text.match(/(?:dr[a]?\.?|m[ée]dic[oa](?:\s+examinador[a]?)?)\s*:?\s*([A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\wÀ-ÿ]+(?:\s+[A-ZÁÂÃÀÉÊÍÓÔÕÚÇa-zà-ÿ]+){1,4})/);
  const doctorName = doctorMatch?.[1]?.trim();

  // ── Trabalhador ──
  const cpfMatch = text.match(/cpf\s*[:\-]?\s*(\d{3}\.?\d{3}\.?\d{3}\-?\d{2})/i);
  const cpf = cpfMatch?.[1]?.replace(/\D/g, '');
  const nameMatch = text.match(/(?:nome|funcion[áa]ri[oa]|colaborador[a]?|trabalhador[a]?)\s*(?:\(a\))?\s*[:\-]\s*([^\n]{3,80})/i);
  const workerName = nameMatch?.[1]?.trim();
  if (!workerName && !cpf) {
    issues.push({ field: 'worker', reason: 'Nem nome nem CPF do trabalhador foram encontrados.' });
  }

  const companyMatch = text.match(/(?:empresa|empregador[a]?|raz[ãa]o\s+social)\s*[:\-]\s*([^\n]{3,80})/i);

  // ── Confiança ──
  //
  // Pesa o que a seção realmente usa. Nome/CPF valem porque sem eles o
  // documento não se liga a ninguém — e um ASO que não se liga a ninguém não
  // vira indicador, por mais bem lido que esteja.
  const weights: [boolean, number][] = [
    [Boolean(examDate), 0.35],
    [Boolean(examKind), 0.2],
    [Boolean(result), 0.15],
    [validityBasis === 'declared_document', 0.15],
    [Boolean(workerName || cpf), 0.15],
  ];
  const confidence = Number(
    weights.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0).toFixed(3),
  );

  // Exame no futuro é quase sempre erro de leitura (ano trocado).
  if (examDate && examDate > today.toISOString().slice(0, 10)) {
    issues.push({
      field: 'examDate',
      reason: `Data do exame (${examDate}) está no futuro — confira o ano no documento.`,
    });
  }

  return {
    examDate,
    examKind,
    result,
    validUntil,
    validityBasis,
    doctorName,
    doctorCrm,
    workerName,
    cpf,
    companyName: companyMatch?.[1]?.trim(),
    confidence,
    issues,
  };
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}

/**
 * Abaixo disto a leitura não vira dado sozinha: o documento entra como
 * pendente de revisão e os campos ficam visíveis para conferência humana.
 */
export const ASO_MIN_CONFIDENCE = 0.5;

export function isWeakExtraction(extraction: AsoExtraction): boolean {
  return extraction.confidence < ASO_MIN_CONFIDENCE || !extraction.examDate;
}

// ── Conferência com o evento S-2220 ─────────────────────────────────────────

export interface AsoDivergence {
  field: 'examDate' | 'examKind' | 'result';
  label: string;
  document: string | null;
  esocial: string | null;
}

export interface EsocialAsoFacts {
  eventId: string;
  examDate: string | null;
  examKind: string | null;
  result: string | null;
}

/** Tolerância entre a data do papel e a do evento, em dias. */
export const ASO_DATE_TOLERANCE_DAYS = 2;

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * Casa o documento com o evento S-2220 do mesmo trabalhador e aponta o que
 * diverge.
 *
 * Escolhe o evento com a data de exame MAIS PRÓXIMA da do documento, e não o
 * mais recente: um colaborador com vários exames no acervo teria todo PDF
 * antigo casado com o último evento, e cada um deles apareceria como
 * divergente.
 */
export function reconcileWithEsocial(
  extraction: Pick<AsoExtraction, 'examDate' | 'examKind' | 'result'>,
  candidates: EsocialAsoFacts[],
): { eventId: string | null; matchStatus: 'matched' | 'divergent' | 'no_esocial_event'; divergences: AsoDivergence[] } {
  if (candidates.length === 0 || !extraction.examDate) {
    return { eventId: null, matchStatus: 'no_esocial_event', divergences: [] };
  }

  const dated = candidates.filter((c) => c.examDate);
  const best = dated.length
    ? dated.reduce((a, b) =>
        daysApart(extraction.examDate!, a.examDate!) <= daysApart(extraction.examDate!, b.examDate!) ? a : b,
      )
    : candidates[0];

  const divergences: AsoDivergence[] = [];

  if (best.examDate && daysApart(extraction.examDate, best.examDate) > ASO_DATE_TOLERANCE_DAYS) {
    divergences.push({
      field: 'examDate',
      label: 'Data do exame',
      document: extraction.examDate,
      esocial: best.examDate,
    });
  }
  if (extraction.examKind && best.examKind && extraction.examKind !== best.examKind) {
    divergences.push({
      field: 'examKind',
      label: 'Tipo de exame',
      document: extraction.examKind,
      esocial: best.examKind,
    });
  }
  if (extraction.result && best.result && extraction.result !== best.result) {
    divergences.push({
      field: 'result',
      label: 'Resultado',
      document: extraction.result,
      esocial: best.result,
    });
  }

  return {
    eventId: best.eventId,
    matchStatus: divergences.length > 0 ? 'divergent' : 'matched',
    divergences,
  };
}
