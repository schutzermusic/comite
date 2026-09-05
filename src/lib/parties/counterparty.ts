/**
 * Precedência de leitura da contraparte — um lugar só.
 *
 * ─── Por que isto é uma função, e não quatro condicionais espalhadas ───────
 *
 * A contraparte é lida em superfícies que não podem divergir: o dossiê, a
 * carteira, o PDF oficial e o objeto legado. Enquanto havia uma fonte só
 * (`counterparty_name`), a coerência era automática. Com duas, ela deixa de ser
 * — e "o PDF mostra um nome, a tela mostra outro" é o tipo de defeito que
 * ninguém encontra até estar num anexo assinado.
 *
 * A regra, por inteiro:
 *
 *   1. há party vinculada  → o nome canônico dela
 *   2. senão, há texto     → o texto, exatamente como está gravado
 *   3. senão               → nada apurado
 *
 * O passo 2 não é degradação temporária: é o estado correto e permanente de
 * todo contrato histórico. Nada nesta fase os "conserta" — porque converter
 * texto em identidade jurídica sem documento é exatamente o erro que a Fase 1
 * existe para não cometer.
 *
 * Módulo PURO: sem React, sem I/O, sem dependência de `@/lib/contracts` — este
 * módulo é importado POR ele, e a seta só aponta num sentido.
 */

import { partyDisplayName, type PartyRow } from './types';

/** De onde o nome exibido veio. A interface e a auditoria precisam distinguir. */
export type CounterpartyOrigin = 'party' | 'text';

export type ResolvedCounterparty = {
  /** Nome a exibir. */
  readonly value: string;
  /** `null` quando a origem é texto livre. */
  readonly partyId: string | null;
  readonly origin: CounterpartyOrigin;
  /**
   * A contraparte está ancorada numa identidade cadastrada?
   *
   * `false` NÃO significa "dado ruim" — significa "não há como cruzar esta
   * contraparte com fiscal, financeiro ou outra carteira". É uma afirmação
   * sobre capacidade, não sobre qualidade.
   */
  readonly canonical: boolean;
};

/**
 * Resolve a contraparte a partir das duas fontes possíveis.
 *
 * `party` ausente ou `null` é o caso comum, não o excepcional.
 */
export function resolveCounterparty(
  counterpartyName: string | null | undefined,
  party?: PartyRow | null,
): ResolvedCounterparty | null {
  if (party) {
    return {
      value: partyDisplayName(party),
      partyId: party.id,
      origin: 'party',
      canonical: true,
    };
  }

  const text = counterpartyName?.trim();
  if (text) {
    return { value: text, partyId: null, origin: 'text', canonical: false };
  }

  return null;
}

/**
 * Resolve a party de um registro dentro de um lote já carregado.
 *
 * Um id que não está no mapa cai em texto — e isso é deliberado: a party pode
 * estar fora do alcance da RLS do leitor, e nesse caso mostrar o texto livre é
 * melhor do que mostrar um vazio que ninguém sabe explicar.
 */
export function partyFor(
  counterpartyPartyId: string | null | undefined,
  parties?: ReadonlyMap<string, PartyRow>,
): PartyRow | null {
  if (!counterpartyPartyId || !parties) return null;
  return parties.get(counterpartyPartyId) ?? null;
}
