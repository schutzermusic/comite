/**
 * Aditivos contratuais — instrumento, efeito e estado vigente.
 *
 * O problema que este arquivo resolve: um contrato de dois anos com três
 * aditivos tem QUATRO respostas possíveis para "quanto vale?", e três delas
 * estão erradas dependendo de quem pergunta. O valor original, o valor depois
 * do segundo aditivo, o valor vigente hoje e o valor que vigorará em janeiro
 * são fatos diferentes — e o produto precisa saber dizer qual está exibindo.
 *
 * A regra que governa tudo aqui:
 *
 *   O CONTRATO MESTRE NUNCA É SOBRESCRITO.
 *
 * `contracts.total_value` e `contracts.end_date` continuam sendo o que o
 * contrato ORIGINAL dizia, para sempre. O estado vigente é DERIVADO, a partir
 * apenas dos efeitos explicitamente registrados. Gravar o valor novo por cima
 * do mestre pareceria mais simples e destruiria a única cópia do valor
 * original — e a pergunta "de quanto foi o reajuste acumulado?" deixaria de
 * ter resposta no dia em que alguém precisasse dela para uma auditoria.
 *
 * O segundo princípio: quando o efeito não pode ser aplicado com segurança, o
 * resultado é AUSÊNCIA, não um número plausível. Um aditivo que altera o valor
 * mas não diz a partir de quando não pode ser ordenado contra os outros — e um
 * total calculado em ordem arbitrária é pior que nenhum total, porque parece
 * confiável.
 *
 * Lógica pura, sem I/O e sem JSX, como todo o restante de `trust/`.
 */

import { live, derived, missing, hasOfficialValue, isError, type Official } from './trusted';
import type { ContractAmendmentRow } from '../contract-service';

/** Por que um aditivo registrado não entrou no cálculo do estado vigente. */
export type AmendmentSkipReason =
  /** `draft` ou `cancelled`: registrado, ainda (ou nunca) em vigor. */
  | 'not-in-force'
  /** Não declara efeito sobre valor nem prazo — altera só escopo, ou nada. */
  | 'no-declared-effect'
  /** Em vigor e com efeito, mas sem data de efeito: não há como ordená-lo. */
  | 'undated'
  | 'future';

export type AmendmentStep = {
  readonly amendment: ContractAmendmentRow;
  /** Entrou no cálculo. */
  readonly applied: boolean;
  readonly skipReason: AmendmentSkipReason | null;
  /** Valor resultante DEPOIS deste aditivo, quando ele altera valor. */
  readonly valueAfter: number | null;
  /** Vigência resultante DEPOIS deste aditivo, quando ele altera prazo. */
  readonly endDateAfter: Date | null;
};

export type EffectiveContractState = {
  /** O que o contrato ORIGINAL dizia. Nunca muda. */
  readonly originalValue: Official<number>;
  readonly originalEndDate: Official<Date>;
  /** O que vale HOJE, derivado dos efeitos registrados. */
  readonly currentValue: Official<number>;
  readonly currentEndDate: Official<Date>;
  /** A linha do tempo inteira, aplicados e ignorados, na ordem de efeito. */
  readonly timeline: readonly AmendmentStep[];
  /** Aditivos em vigor cujo efeito NÃO pôde ser aplicado. */
  readonly unapplied: readonly AmendmentStep[];
  /** Algum aditivo altera valor ou prazo e foi de fato aplicado. */
  readonly hasEffects: boolean;
  /**
   * A leitura dos aditivos FALHOU.
   *
   * Distinto de `timeline` vazia. Sem esta bandeira, a interface e o PDF
   * diriam "nenhum aditivo registrado" sobre um contrato cujos aditivos não
   * puderam ser lidos — que é a afirmação oposta e leva a decisão oposta.
   */
  readonly readFailed: boolean;
  /** Os aditivos não foram consultados neste contexto. */
  readonly notMeasured: boolean;
};

/** Status em que um aditivo produz efeito. `draft` e `cancelled` não produzem. */
const IN_FORCE = new Set(['signed', 'active']);

export const isAmendmentInForce = (a: ContractAmendmentRow): boolean =>
  IN_FORCE.has(a.status) && !a.deleted_at;

/** O aditivo declara efeito sobre valor? */
export const declaresValueEffect = (a: ContractAmendmentRow): boolean =>
  a.value_delta !== null || a.value_absolute !== null;

/** O aditivo declara efeito sobre prazo? */
export const declaresTermEffect = (a: ContractAmendmentRow): boolean =>
  a.new_end_date !== null || a.term_extension_days !== null;

const toNumber = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

const addDays = (d: Date, days: number): Date => {
  const out = new Date(d.getTime());
  out.setDate(out.getDate() + days);
  return out;
};

/**
 * Ordena os aditivos pelo momento em que produzem efeito.
 *
 * Critério: data de efeito, depois número, depois criação. O desempate por
 * número importa quando dois aditivos entram em vigor no mesmo dia — caso real
 * em pacotes de repactuação — e sem ele a ordem dependeria de qual linha o
 * banco devolveu primeiro, tornando o total vigente instável entre execuções.
 */
export function orderAmendments(
  amendments: readonly ContractAmendmentRow[],
): readonly ContractAmendmentRow[] {
  return [...amendments].sort((a, b) => {
    const da = toDate(a.effective_date)?.getTime() ?? Number.POSITIVE_INFINITY;
    const db = toDate(b.effective_date)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    const na = a.amendment_number.localeCompare(b.amendment_number, 'pt-BR', { numeric: true });
    if (na !== 0) return na;
    return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
  });
}

/**
 * Deriva o estado contratual vigente a partir do mestre e dos aditivos.
 *
 * `amendments` chega como `Official` porque a ausência de leitura precisa
 * sobreviver até aqui: um contrato cujos aditivos não foram lidos NÃO tem
 * "nenhum aditivo" — tem aditivos desconhecidos, e afirmar que o valor vigente
 * é o original nesse caso seria inventar.
 */
export function effectiveContractState(
  originalValue: Official<number>,
  originalEndDate: Official<Date>,
  amendments: Official<readonly ContractAmendmentRow[]>,
  asOf?: string,
): EffectiveContractState {
  const cutoff = asOf === undefined ? new Date() : toDate(asOf);
  if (!cutoff) throw new Error("Invalid Contracts asOf date");
  // Leitura falhou ou não houve: o vigente herda exatamente essa incerteza.
  if (isError(amendments) || !hasOfficialValue(amendments)) {
    const carry = <T>(o: Official<T>): Official<T> =>
      isError(amendments)
        ? amendments as unknown as Official<T>
        : missing<T>('no-rows', 'aditivos não apurados neste contexto');
    return {
      originalValue,
      originalEndDate,
      currentValue: hasOfficialValue(originalValue) ? carry(originalValue) : originalValue,
      currentEndDate: hasOfficialValue(originalEndDate) ? carry(originalEndDate) : originalEndDate,
      timeline: [],
      unapplied: [],
      hasEffects: false,
      readFailed: isError(amendments),
      notMeasured: !isError(amendments),
    };
  }

  const ordered = orderAmendments(amendments.value.filter((a) => !a.deleted_at));

  let value: number | null = hasOfficialValue(originalValue) ? originalValue.value : null;
  let endDate: Date | null = hasOfficialValue(originalEndDate) ? originalEndDate.value : null;

  /*
    Um aditivo EM VIGOR que declara efeito mas não tem data de efeito envenena
    a derivação inteira daquela dimensão: sabemos que algo mudou e não sabemos
    em que ordem. Aplicar os demais e ignorar este produziria um número que
    parece completo e não é.
  */
  let valueUndated = false;
  let termUndated = false;

  const timeline: AmendmentStep[] = [];

  for (const a of ordered) {
    const inForce = isAmendmentInForce(a);
    const hasValue = declaresValueEffect(a);
    const hasTerm = declaresTermEffect(a);
    const dated = toDate(a.effective_date) !== null;

    let skipReason: AmendmentSkipReason | null = null;
    if (!inForce) skipReason = 'not-in-force';
    else if (!hasValue && !hasTerm) skipReason = 'no-declared-effect';
    else if (!dated) skipReason = 'undated';
    else if (toDate(a.effective_date)!.getTime() > cutoff.getTime()) skipReason = 'future';

    if (skipReason === 'undated') {
      if (hasValue) valueUndated = true;
      if (hasTerm) termUndated = true;
    }

    let valueAfter: number | null = null;
    let endDateAfter: Date | null = null;

    if (skipReason === null) {
      if (hasValue) {
        const absolute = toNumber(a.value_absolute);
        const delta = toNumber(a.value_delta);
        if (absolute !== null) {
          // Redefinição: o aditivo diz quanto o contrato PASSA A VALER.
          value = absolute;
        } else if (delta !== null && value !== null) {
          value = value + delta;
        } else if (delta !== null && value === null) {
          /*
            Acréscimo sobre base desconhecida. O contrato mestre não registra
            valor, então "+R$ 200k" não produz total nenhum — só produziria se
            alguém assumisse que a base era zero, que é uma invenção.
          */
          valueUndated = true;
        }
        valueAfter = value;
      }
      if (hasTerm) {
        const explicit = toDate(a.new_end_date);
        if (explicit) {
          endDate = explicit;
        } else if (a.term_extension_days !== null && endDate !== null) {
          endDate = addDays(endDate, a.term_extension_days);
        } else if (a.term_extension_days !== null && endDate === null) {
          // Prorrogação sobre vigência desconhecida: mesma lógica do valor.
          termUndated = true;
        }
        endDateAfter = endDate;
      }
    }

    timeline.push({
      amendment: a,
      applied: skipReason === null && (hasValue || hasTerm),
      skipReason,
      valueAfter,
      endDateAfter,
    });
  }

  const appliedValue = timeline.some((s) => s.applied && declaresValueEffect(s.amendment));
  const appliedTerm = timeline.some((s) => s.applied && declaresTermEffect(s.amendment));

  const currentValue: Official<number> = valueUndated
    ? missing<number>(
        'not-comparable',
        'há aditivo em vigor que altera o valor sem data de efeito registrada',
      )
    : appliedValue && value !== null
      ? derived(value, {
          rule: 'valor original acrescido dos efeitos registrados nos aditivos em vigor',
          from: ['contracts'],
          coverage: {
            counted: timeline.filter((s) => s.applied && declaresValueEffect(s.amendment)).length,
            total: ordered.filter(declaresValueEffect).length,
          },
        })
      : originalValue;

  const currentEndDate: Official<Date> = termUndated
    ? missing<Date>(
        'not-comparable',
        'há aditivo em vigor que altera o prazo sem data de efeito registrada',
      )
    : appliedTerm && endDate !== null
      ? derived(endDate, {
          rule: 'vigência original alterada pelos efeitos registrados nos aditivos em vigor',
          from: ['contracts'],
          coverage: {
            counted: timeline.filter((s) => s.applied && declaresTermEffect(s.amendment)).length,
            total: ordered.filter(declaresTermEffect).length,
          },
        })
      : originalEndDate;

  return {
    originalValue,
    originalEndDate,
    currentValue,
    currentEndDate,
    timeline,
    unapplied: timeline.filter((s) => s.skipReason !== null),
    hasEffects: appliedValue || appliedTerm,
    readFailed: false,
    notMeasured: false,
  };
}

/** Rótulo do motivo pelo qual um aditivo ficou de fora, para a interface. */
export const SKIP_REASON_LABEL: Record<AmendmentSkipReason, string> = {
  'not-in-force': 'registrado, ainda não em vigor',
  'no-declared-effect': 'não altera valor nem prazo',
  'undated': 'sem data de efeito registrada',
  'future': 'efeito futuro',
};

/**
 * Os instrumentos do contrato, na ordem em que se lêem: mestre primeiro,
 * aditivos por ordem de efeito.
 *
 * Existe para que a seção "Instrumentos Contratuais" do dossiê não precise
 * reordenar nada — a ordem É a mesma da derivação, e duas ordens diferentes na
 * mesma tela para a mesma lista seria um convite ao erro de leitura.
 */
export type ContractInstrument =
  | { readonly kind: 'master'; readonly title: string; readonly documentId: string | null }
  | { readonly kind: 'amendment'; readonly step: AmendmentStep };

export function contractInstruments(
  masterTitle: string,
  masterDocumentId: string | null,
  state: EffectiveContractState,
): readonly ContractInstrument[] {
  return [
    { kind: 'master', title: masterTitle, documentId: masterDocumentId },
    ...state.timeline.map((step) => ({ kind: 'amendment' as const, step })),
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// Linhagem de cláusula
// ═══════════════════════════════════════════════════════════════════════════

/**
 * O que aconteceu com uma cláusula ao longo dos aditivos.
 *
 * A regra: a cláusula ORIGINAL nunca some. Quando um aditivo lhe dá nova
 * redação, as duas coexistem — a original como verdade histórica sobre o que o
 * contrato dizia, a nova como o que vale agora. Sobrescrever o texto anterior
 * pareceria mais limpo e destruiria a resposta para "o que essa cláusula dizia
 * quando assinamos?", que é a pergunta que uma disputa contratual faz.
 */
export type ClauseLineageEntry = {
  readonly amendmentId: string;
  readonly amendmentNumber: string;
  readonly effect: 'altered' | 'added' | 'removed';
  /** A cláusula que passa a valer, quando o aditivo dá nova redação. */
  readonly replacementClauseId: string | null;
  readonly note: string | null;
  /** O aditivo está em vigor — o efeito sobre a cláusula é atual. */
  readonly inForce: boolean;
};

export type ClauseLineage = {
  readonly clauseId: string;
  /** Aditivos que atingiram esta cláusula, em ordem de efeito. */
  readonly entries: readonly ClauseLineageEntry[];
  /** Foi suprimida por aditivo EM VIGOR. */
  readonly removed: boolean;
  /** Id da redação vigente: a última substituta em vigor, ou a própria. */
  readonly currentClauseId: string;
};

type AmendmentClauseLink = {
  amendment_id: string;
  clause_id: string | null;
  replacement_clause_id: string | null;
  effect: string;
  note: string | null;
};

/**
 * Monta a linhagem de cada cláusula atingida por algum aditivo.
 *
 * Cláusulas que nenhum aditivo tocou não aparecem no mapa: a ausência de
 * entrada significa "nunca alterada", e criar entrada vazia para todas
 * confundiria "não foi tocada" com "foi analisada e nada mudou".
 */
/** @deprecated Historical relationship summary only. Use resolveContractAsOf for effective clauses. */
export function clauseLineages(
  amendments: readonly ContractAmendmentRow[],
  links: readonly AmendmentClauseLink[],
): ReadonlyMap<string, ClauseLineage> {
  const byId = new Map(amendments.map((a) => [a.id, a]));
  const ordered = orderAmendments(amendments);
  const position = new Map(ordered.map((a, i) => [a.id, i]));

  const grouped = new Map<string, AmendmentClauseLink[]>();
  for (const link of links) {
    if (!link.clause_id) continue; // `added` sem alvo não tem linhagem própria
    const list = grouped.get(link.clause_id) ?? [];
    list.push(link);
    grouped.set(link.clause_id, list);
  }

  const out = new Map<string, ClauseLineage>();

  for (const [clauseId, list] of grouped) {
    const sorted = [...list].sort(
      (a, b) => (position.get(a.amendment_id) ?? 0) - (position.get(b.amendment_id) ?? 0),
    );

    const entries: ClauseLineageEntry[] = sorted.map((link) => {
      const a = byId.get(link.amendment_id);
      return {
        amendmentId: link.amendment_id,
        amendmentNumber: a?.amendment_number ?? '—',
        effect: link.effect as 'altered' | 'added' | 'removed',
        replacementClauseId: link.replacement_clause_id,
        note: link.note,
        inForce: a ? isAmendmentInForce(a) : false,
      };
    });

    /*
      Só aditivo EM VIGOR muda o que vale. Um rascunho que propõe nova redação
      fica registrado e visível, mas a cláusula vigente continua sendo a
      anterior — senão um rascunho alteraria o contrato.
    */
    const effective = entries.filter((e) => e.inForce);
    const removed = effective.some((e) => e.effect === 'removed');
    const lastReplacement = [...effective].reverse()
      .find((e) => e.effect === 'altered' && e.replacementClauseId);

    out.set(clauseId, {
      clauseId,
      entries,
      removed,
      currentClauseId: lastReplacement?.replacementClauseId ?? clauseId,
    });
  }

  return out;
}
