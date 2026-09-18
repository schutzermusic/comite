/**
 * O LOCAL DE EXECUÇÃO, EXTRAÍDO DO CONTRATO — lógica pura, sem rede e sem banco.
 *
 * ─── A pergunta que este arquivo responde ─────────────────────────────────
 *
 * "O contrato assinado diz ONDE o serviço será executado, com confiança
 * suficiente para virar a coordenada canônica do projeto e um ponto no globo?"
 *
 * As respostas possíveis são três, e a terceira é a que mais importa:
 * SIM, NÃO, e NÃO DÁ PARA SABER. A terceira não vira palpite.
 *
 * ─── Por que endereço de contrato quase sempre é a resposta ERRADA ────────
 *
 * Todo contrato tem endereço. Quase nenhum deles é o lugar onde se trabalha:
 *
 *   · sede da empresa        — onde fica a diretoria
 *   · endereço legal/foro    — onde se processa
 *   · endereço de cobrança   — para onde vai a nota
 *   · correspondência        — para onde vai a carta
 *
 * Propagar qualquer um desses para o globo colocaria o projeto de reforma de
 * um gerador no bairro da sede da contratante. Por isso a extração aqui é
 * DESQUALIFICADORA por padrão: um texto só se torna candidato se nomear uma
 * INSTALAÇÃO, e é descartado se cheirar a endereço administrativo — mesmo que
 * também nomeie uma instalação, porque a ambiguidade é o próprio defeito.
 *
 * ─── Onde para a responsabilidade deste arquivo ───────────────────────────
 *
 * Ele produz um CANDIDATO textual com proveniência (documento, página,
 * trecho). Ele NÃO geocodifica e NÃO inventa coordenada — converter nome em
 * latitude é trabalho de um gazeteer externo, e o portão de confiança daquele
 * resultado mora em `geocode-gate.ts`.
 */

/** Por que um texto foi aceito — ou recusado — como local de execução. */
export type LocationEvidenceKind =
  /** Objeto/escopo do contrato: "serviços na UHE X, Unidade Geradora 05". */
  | 'contract_scope'
  /** Cláusula que nomeia o local de execução. */
  | 'contract_clause'
  /** Nada no contrato sustenta um local de execução. */
  | 'none';

export type LocationRejectionReason =
  | 'ADMINISTRATIVE_ADDRESS'
  | 'NO_FACILITY_NAMED'
  | 'MULTIPLE_CONFLICTING_SITES'
  | 'TOO_VAGUE';

export interface LocationCandidate {
  /** O nome da instalação, normalizado. Ex.: "UHE Cachoeira Dourada". */
  readonly siteLabel: string;
  /** A consulta que será entregue ao geocodificador. */
  readonly geocodeQuery: string;
  readonly evidenceKind: Exclude<LocationEvidenceKind, 'none'>;
  readonly sourceDocumentId: string | null;
  readonly sourcePage: number | null;
  /** O trecho literal que sustenta a afirmação. Proveniência, não resumo. */
  readonly sourceExcerpt: string;
}

export interface LocationEvidenceResult {
  readonly candidate: LocationCandidate | null;
  /** Preenchido quando não há candidato, ou quando há mais de um conflitante. */
  readonly rejection: LocationRejectionReason | null;
  /** Todos os candidatos vistos, para que o conflito seja auditável. */
  readonly seen: readonly LocationCandidate[];
}

/** O texto de origem, com a proveniência já anexada. */
export interface LocationEvidenceSource {
  readonly text: string;
  readonly kind: Exclude<LocationEvidenceKind, 'none'>;
  readonly documentId: string | null;
  readonly page: number | null;
}

/**
 * Termos que marcam endereço ADMINISTRATIVO.
 *
 * A presença de qualquer um destes descarta o trecho inteiro. Não se tenta
 * "extrair a parte boa": um parágrafo que fala de sede e de usina ao mesmo
 * tempo é ambíguo, e ambíguo é motivo de recusa, não de heurística.
 */
const ADMINISTRATIVE = [
  'sede', 'matriz', 'filial',
  'endereço legal', 'domicílio', 'foro', 'comarca',
  'cobrança', 'faturamento', 'correspondência', 'notificaç',
  'inscrita no cnpj', 'com sede', 'estabelecida na',
] as const;

/**
 * Instalações operacionais que o domínio reconhece.
 *
 * A lista é curta e explícita de propósito. Uma expressão genérica de
 * "parece um lugar" traria de volta exatamente os endereços administrativos
 * que o bloco acima existe para descartar.
 */
const FACILITY_PATTERNS: readonly { re: RegExp; normalize: (m: RegExpMatchArray) => string }[] = [
  // UHE / PCH / UTE / EOL / UFV seguidos do nome próprio da instalação.
  {
    re: /\b(UHE|PCH|UTE|UEE|EOL|UFV|SE)\s+([A-ZÀ-Ü][\wÀ-ÿ'’-]*(?:\s+(?:d[aeo]s?|,)?\s*[A-ZÀ-Ü][\wÀ-ÿ'’-]*){0,3})/g,
    normalize: (m) => `${m[1].toUpperCase()} ${m[2].trim()}`,
  },
  // "Usina Hidrelétrica de X", "Usina Termelétrica X".
  {
    re: /\bUsinas?\s+(?:Hidrel[ée]trica|Termel[ée]trica|E[óo]lica|Fotovoltaica)\s+(?:d[aeo]s?\s+)?([A-ZÀ-Ü][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ü][\wÀ-ÿ'’-]*){0,3})/g,
    normalize: (m) => `Usina ${m[1].trim()}`,
  },
  // "Subestação X", "Planta X", "Fábrica X" enquanto instalação nomeada.
  {
    re: /\b(Subestaç[ãa]o|Planta|Complexo)\s+([A-ZÀ-Ü][\wÀ-ÿ'’-]*(?:\s+[A-ZÀ-Ü][\wÀ-ÿ'’-]*){0,2})/g,
    normalize: (m) => `${m[1]} ${m[2].trim()}`,
  },
];

const norm = (s: string) => s.toLowerCase();

/** Duas menções ao mesmo lugar não são um conflito. */
const sameSite = (a: string, b: string) =>
  norm(a).replace(/\s+/g, ' ').trim() === norm(b).replace(/\s+/g, ' ').trim();

function extractFromSource(src: LocationEvidenceSource): readonly LocationCandidate[] {
  const text = src.text?.trim();
  if (!text) return [];

  // Porta desqualificadora: qualquer sinal administrativo derruba o trecho.
  const lower = norm(text);
  if (ADMINISTRATIVE.some((t) => lower.includes(t))) return [];

  const out: LocationCandidate[] = [];
  for (const { re, normalize } of FACILITY_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
      const siteLabel = normalize(m);
      // Um rótulo de uma palavra depois da sigla costuma ser ruído de OCR.
      if (siteLabel.replace(/^(UHE|PCH|UTE|UEE|EOL|UFV|SE)\s+/i, '').length < 4) continue;
      if (out.some((c) => sameSite(c.siteLabel, siteLabel))) continue;
      out.push({
        siteLabel,
        geocodeQuery: siteLabel,
        evidenceKind: src.kind,
        sourceDocumentId: src.documentId,
        sourcePage: src.page,
        sourceExcerpt: text.length > 600 ? `${text.slice(0, 600)}…` : text,
      });
    }
  }
  return out;
}

/**
 * O local de execução que o contrato sustenta — ou a razão de não sustentar.
 *
 * Um único local, e apenas um. Dois locais diferentes nomeados no contrato não
 * produzem "o primeiro": produzem `MULTIPLE_CONFLICTING_SITES`, porque
 * escolher um deles seria a tela decidindo algo que o documento não decidiu.
 */
export function resolveContractLocationEvidence(
  sources: readonly LocationEvidenceSource[],
): LocationEvidenceResult {
  const seen = sources.flatMap(extractFromSource);
  if (seen.length === 0) {
    const hadText = sources.some((s) => s.text?.trim());
    return { candidate: null, rejection: hadText ? 'NO_FACILITY_NAMED' : 'TOO_VAGUE', seen };
  }

  const distinct = seen.filter(
    (c, i) => seen.findIndex((o) => sameSite(o.siteLabel, c.siteLabel)) === i,
  );
  if (distinct.length > 1) {
    return { candidate: null, rejection: 'MULTIPLE_CONFLICTING_SITES', seen };
  }

  // Entre menções do mesmo lugar, prefere a que tem página — proveniência mais
  // precisa é o que alguém vai querer abrir depois para conferir.
  const best = seen.filter((c) => sameSite(c.siteLabel, distinct[0].siteLabel))
    .sort((a, b) => (b.sourcePage ?? -1) - (a.sourcePage ?? -1))
    .find((c) => c.sourcePage !== null) ?? distinct[0];

  return { candidate: best, rejection: null, seen };
}
