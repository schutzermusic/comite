/**
 * Trust Layer de Contratos — `Trusted<T>`.
 *
 * ─── A regra que este arquivo existe para sustentar ────────────────────────
 *
 * Contratos exibe somente dado em que se pode confiar, e diz explicitamente de
 * onde ele veio. Onde não há fonte, a interface diz "não apurado": nunca `0`,
 * nunca um número derivado de hash. A razão já custou caro no módulo vizinho:
 * depois de formatado na tela, um número modelado é indistinguível de um número
 * apurado. A única defesa é não produzi-lo.
 *
 * Até aqui isso era convenção. `enrichContractsForGovernance` fabricava
 * obrigações, faturamento (escada fixa 10/40/50%), cláusulas, auditoria e
 * margem a partir de `hash(id + nome)`, e `applyLiveGovernanceData` só
 * sobrescrevia onde houvesse linha real — de modo que a Executive Band e o PDF
 * oficial apresentavam ficção sempre que a relação estivesse vazia. Pior: uma
 * consulta que FALHAVA era indistinguível de uma que voltou vazia.
 *
 * `Trusted<T>` move a regra para o tipo. Os cinco estados deixam de ser valores
 * diferentes e passam a ser FORMAS diferentes — `missing` e `error` não têm
 * `.value` nenhum, então o compilador não deixa somar, formatar ou comparar um
 * indicador sem antes decidir o que fazer quando ele não existe. Cada
 * renderizador tem um único ponto onde "não apurado" vira pixel, e é impossível
 * esquecer de passar por ele.
 *
 * ─── Por que não reusar `Measured<T>` de Pessoas & Custos ──────────────────
 *
 * `Measured<T>` (src/lib/workforce/overview/types.ts) é o precedente e a forma
 * é deliberadamente a mesma. Contratos precisa de duas coisas que ele não tem:
 *
 *   1. distinguir `derived` (calculado deterministicamente a partir de entrada
 *      confiável, carregando a regra e as fontes que o produziram) de `live`
 *      (lido direto da fonte). Health Score e Revenue at Risk são derivados, e
 *      precisam ser explicáveis — não basta dizer que foram medidos;
 *   2. um estado `demo` de primeira classe, para que o preview sintético siga
 *      útil em dev sem poder alcançar superfície oficial.
 *
 * ─── Fronteiras ────────────────────────────────────────────────────────────
 *
 * Sem React, sem I/O, sem `'use client'`. Roda em Node para os testes e para
 * qualquer geração server-side de relatório.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Os cinco estados
// ═══════════════════════════════════════════════════════════════════════════

export type TrustState = 'live' | 'derived' | 'missing' | 'error' | 'demo';

/** De onde um valor `live` foi lido. Serve à explicabilidade e à auditoria. */
export type LiveSource =
  | 'contracts'
  | 'contract_obligations'
  | 'contract_billing_events'
  | 'contract_documents'
  | 'contract_approvals'
  | 'contract_project_links'
  | 'contract_risks_links'
  | 'contract_ai_analyses'
  | 'contract_milestones'
  | 'contract_clauses'
  | 'contract_penalties'
  | 'audit_logs'
  | 'risks';

/**
 * Por que um indicador não pôde ser apurado.
 *
 * O motivo importa: "a consulta voltou vazia" e "a consulta falhou" pedem
 * mensagens diferentes na tela, e uma delas é um incidente, não uma ausência.
 */
export type MissingReason =
  /** A consulta teve sucesso e não há linha. Ausência legítima. */
  | 'no-rows'
  /** A coluna existe mas está nula na origem. */
  | 'null-in-source'
  /** Depende de integração que ainda não existe (ex.: caixa realizado no razão). */
  | 'not-integrated'
  /**
   * A tabela existe no schema, mas NADA no produto escreve nela.
   *
   * Distinto de `no-rows`: "ninguém registrou ainda" convida o usuário a
   * registrar; "não há por onde registrar" é uma lacuna de produto, e prometer
   * a primeira quando a verdade é a segunda manda o usuário procurar um botão
   * que não existe. Hoje se aplica a `contract_milestones` e
   * `contract_clauses` — lidas em três pontos do código, escritas em nenhum.
   */
  | 'not-instrumented'
  /** Existe no total, mas não se reparte pelo recorte aplicado. */
  | 'not-attributable'
  /** As duas pontas da razão não foram apuradas. */
  | 'not-comparable'
  /** A permissão do usuário não alcança a fonte. */
  | 'no-permission'
  /** Havia valor de demonstração, descartado ao cruzar para superfície oficial. */
  | 'demo-excluded'
  /**
   * O contrato existe e o valor foi lido, mas a ORIGEM da linha nunca foi
   * validada (`contracts.data_class = 'unclassified'`).
   *
   * Deliberadamente distinto de `demo-excluded`: afirmar "é demonstração" sobre
   * uma linha de origem desconhecida seria uma afirmação que ninguém verificou
   * — o mesmo erro que este módulo passou quatro fases desfazendo, apenas na
   * direção oposta.
   */
  | 'unclassified-contract';

/**
 * Como um valor `derived` foi produzido. Existe para que todo número calculado
 * consiga responder "de onde você saiu?" sem que ninguém precise ler o código.
 */
export type Derivation = {
  /** A regra aplicada, em linguagem de negócio. Ex.: 'soma de eventos faturados'. */
  readonly rule: string;
  /** As fontes que alimentaram o cálculo. */
  readonly from: readonly LiveSource[];
  /**
   * Cobertura do cálculo quando ele agrega várias entradas: quantas
   * contribuíram de fato e quantas existiam. Um total com `counted < total` é
   * verdadeiro mas PARCIAL, e a interface precisa poder dizer isso.
   */
  readonly coverage?: { readonly counted: number; readonly total: number };
};

export type Trusted<T> =
  /** Lido direto da fonte. `0` aqui é um zero apurado e legítimo. */
  | { readonly trust: 'live'; readonly value: T; readonly source: LiveSource }
  /** Calculado deterministicamente a partir de entrada confiável. */
  | { readonly trust: 'derived'; readonly value: T; readonly derivation: Derivation }
  /** Não há dado. NUNCA equivale a `0` nem a `[]`. */
  | { readonly trust: 'missing'; readonly reason: MissingReason; readonly note?: string }
  /** A leitura falhou. NUNCA equivale a ausência, a `0`, nem a "estimado". */
  | { readonly trust: 'error'; readonly message: string; readonly source?: LiveSource }
  /** Sintético, para desenvolvimento e demonstração. Barrado em superfície oficial. */
  | { readonly trust: 'demo'; readonly value: T; readonly note: string };

/**
 * O subconjunto que pode alcançar superfície OFICIAL — Executive Band, Contract
 * Health, Revenue at Risk, recomendações e PDF.
 *
 * `demo` está excluído POR TIPO, não por convenção: passar um `Trusted<T>` para
 * um consumidor oficial não compila. A única porta de entrada é `toOfficial()`,
 * que converte demo em `missing('demo-excluded')` de forma explícita e visível
 * no diff.
 */
export type Official<T> = Exclude<Trusted<T>, { trust: 'demo' }>;

// ═══════════════════════════════════════════════════════════════════════════
// Construtores
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Os quatro construtores oficiais devolvem `Official<T>`, não `Trusted<T>`.
 *
 * A precisão importa: `Official<T>` é um subtipo de `Trusted<T>`, então um
 * valor oficial serve em qualquer lugar — mas o contrário não vale. É isso que
 * permite a uma agregação declarar `Official<number>[]` e o compilador recusar
 * dado de demonstração na porta, sem nenhuma checagem em runtime.
 */
export const live = <T>(value: T, source: LiveSource): Official<T> =>
  ({ trust: 'live', value, source });

export const derived = <T>(value: T, derivation: Derivation): Official<T> =>
  ({ trust: 'derived', value, derivation });

export const missing = <T = never>(reason: MissingReason, note?: string): Official<T> =>
  ({ trust: 'missing', reason, note });

export const failed = <T = never>(message: string, source?: LiveSource): Official<T> =>
  ({ trust: 'error', message, source });

/** Único construtor NÃO oficial. O tipo de retorno o denuncia. */
export const demo = <T>(value: T, note: string): DemoTrusted<T> =>
  ({ trust: 'demo', value, note });

/** O ramo de demonstração, isolado para que assinaturas possam nomeá-lo. */
export type DemoTrusted<T> = Extract<Trusted<T>, { trust: 'demo' }>;

// ═══════════════════════════════════════════════════════════════════════════
// Guardas — o mecanismo de estreitamento que o compilador usa
// ═══════════════════════════════════════════════════════════════════════════

export const isLive = <T>(t: Trusted<T>): t is Extract<Trusted<T>, { trust: 'live' }> =>
  t.trust === 'live';

export const isDerived = <T>(t: Trusted<T>): t is Extract<Trusted<T>, { trust: 'derived' }> =>
  t.trust === 'derived';

export const isMissing = <T>(t: Trusted<T>): t is Extract<Trusted<T>, { trust: 'missing' }> =>
  t.trust === 'missing';

export const isError = <T>(t: Trusted<T>): t is Extract<Trusted<T>, { trust: 'error' }> =>
  t.trust === 'error';

export const isDemo = <T>(t: Trusted<T>): t is Extract<Trusted<T>, { trust: 'demo' }> =>
  t.trust === 'demo';

/** Tem valor utilizável (live, derived ou demo). Não diz nada sobre ser oficial. */
export const hasValue = <T>(
  t: Trusted<T>,
): t is Extract<Trusted<T>, { trust: 'live' | 'derived' | 'demo' }> =>
  t.trust === 'live' || t.trust === 'derived' || t.trust === 'demo';

/** Tem valor E pode ser usado oficialmente. É a guarda das agregações. */
export const hasOfficialValue = <T>(
  t: Official<T>,
): t is Extract<Trusted<T>, { trust: 'live' | 'derived' }> =>
  t.trust === 'live' || t.trust === 'derived';

// ═══════════════════════════════════════════════════════════════════════════
// A porta oficial
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Única conversão de `Trusted<T>` para `Official<T>`.
 *
 * Dado de demonstração não é silenciado nem promovido: vira
 * `missing('demo-excluded')`, preservando a nota original. A superfície oficial
 * então exibe "não apurado" — que é a verdade — em vez de um número inventado.
 */
export function toOfficial<T>(t: Trusted<T>): Official<T> {
  if (t.trust === 'demo') {
    return { trust: 'missing', reason: 'demo-excluded', note: t.note };
  }
  return t;
}

/** Aplica `toOfficial` a um registro inteiro de indicadores. */
export function toOfficialRecord<K extends string, V>(
  record: Record<K, Trusted<V>>,
): Record<K, Official<V>> {
  const out = {} as Record<K, Official<V>>;
  for (const key of Object.keys(record) as K[]) out[key] = toOfficial(record[key]);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Combinadores
// ═══════════════════════════════════════════════════════════════════════════

/** Transforma o valor preservando estado e proveniência. */
export function mapTrusted<A, B>(t: Trusted<A>, fn: (value: A) => B): Trusted<B> {
  switch (t.trust) {
    case 'live': return { trust: 'live', value: fn(t.value), source: t.source };
    case 'derived': return { trust: 'derived', value: fn(t.value), derivation: t.derivation };
    case 'demo': return { trust: 'demo', value: fn(t.value), note: t.note };
    case 'missing': return t;
    case 'error': return t;
  }
}

/**
 * Soma indicadores confiáveis.
 *
 * Contrato de honestidade, na ordem:
 *  - qualquer `error` na entrada contamina o resultado: um total que ignora uma
 *    leitura falha é um total errado apresentado com confiança;
 *  - nenhuma entrada com valor → `missing`, JAMAIS `0`;
 *  - caso contrário → `derived`, com `coverage` registrando quantas das
 *    entradas efetivamente contribuíram. Um total parcial continua verdadeiro,
 *    desde que se saiba que é parcial.
 */
export function sumTrusted(
  values: readonly Official<number>[],
  rule: string,
  from: readonly LiveSource[],
): Official<number> {
  const firstError = values.find(isError);
  if (firstError) {
    return { trust: 'error', message: firstError.message, source: firstError.source };
  }

  const usable = values.filter(hasOfficialValue);
  if (usable.length === 0) {
    if (values.length === 0) return { trust: 'missing', reason: 'no-rows' };

    /**
     * Quando NENHUM item contribuiu e todos foram excluídos pelo mesmo motivo,
     * o total herda esse motivo em vez do genérico `not-attributable`.
     *
     * A diferença é o que a interface consegue dizer: "não atribuível" não
     * explica nada, enquanto "todos os contratos são de demonstração" ou
     * "nenhum contrato teve a origem validada" são respostas acionáveis — e,
     * no caso desta carteira, são a diferença entre o usuário entender que não
     * há contrato ao vivo e achar que houve uma falha de cálculo.
     */
    const reasons = new Set(values.filter(isMissing).map((item) => item.reason));
    if (reasons.size === 1) {
      const [only] = [...reasons];
      return { trust: 'missing', reason: only };
    }
    return { trust: 'missing', reason: 'not-attributable' };
  }

  return {
    trust: 'derived',
    value: usable.reduce((sum, item) => sum + item.value, 0),
    derivation: { rule, from, coverage: { counted: usable.length, total: values.length } },
  };
}

/** Conta itens que satisfazem um predicado. A contagem só é oficial se a lista for. */
export function countTrusted<T>(
  list: Official<readonly T[]>,
  predicate: (item: T) => boolean,
  rule: string,
  from: readonly LiveSource[],
): Official<number> {
  if (!hasOfficialValue(list)) return list;
  return {
    trust: 'derived',
    value: list.value.filter(predicate).length,
    derivation: { rule, from },
  };
}

/**
 * Razão entre dois indicadores. `missing` quando qualquer ponta não foi apurada
 * — uma porcentagem sobre denominador desconhecido é uma afirmação falsa — e
 * também quando o denominador é zero.
 */
export function ratioTrusted(
  numerator: Official<number>,
  denominator: Official<number>,
  rule: string,
  from: readonly LiveSource[],
): Official<number> {
  if (isError(numerator)) return numerator;
  if (isError(denominator)) return denominator;
  if (!hasOfficialValue(numerator) || !hasOfficialValue(denominator)) {
    return { trust: 'missing', reason: 'not-comparable' };
  }
  if (denominator.value === 0) {
    return { trust: 'missing', reason: 'not-comparable', note: 'denominador zero' };
  }
  return {
    trust: 'derived',
    value: numerator.value / denominator.value,
    derivation: { rule, from },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Renderização — o ÚNICO ponto onde "não apurado" vira pixel
// ═══════════════════════════════════════════════════════════════════════════

/** Texto padrão para cada estado sem valor. `error` nunca diz "estimado". */
export const TRUST_FALLBACK_LABEL = {
  missing: 'Não apurado',
  error: 'Dados indisponíveis',
  demoExcluded: 'Não apurado',
} as const;

export type RenderTrustedOptions<T, R> = {
  /** Como desenhar um valor apurado ou derivado. */
  readonly onValue: (value: T, state: Extract<TrustState, 'live' | 'derived'>) => R;
  readonly onMissing: (reason: MissingReason, note?: string) => R;
  readonly onError: (message: string, source?: LiveSource) => R;
  /** Só é exigido em superfícies não oficiais que aceitam demonstração. */
  readonly onDemo?: (value: T, note: string) => R;
};

/**
 * Converte um `Trusted<T>` em algo desenhável, obrigando o chamador a decidir o
 * que fazer em cada estado. É deliberadamente incômodo: não existe atalho que
 * transforme ausência em `0`.
 *
 * Em superfície oficial, prefira `renderOfficial`, que nem aceita `demo`.
 */
export function renderTrusted<T, R>(t: Trusted<T>, options: RenderTrustedOptions<T, R>): R {
  switch (t.trust) {
    case 'live': return options.onValue(t.value, 'live');
    case 'derived': return options.onValue(t.value, 'derived');
    case 'missing': return options.onMissing(t.reason, t.note);
    case 'error': return options.onError(t.message, t.source);
    case 'demo':
      // Sem tratador explícito, demonstração NÃO vaza como se fosse valor.
      return options.onDemo
        ? options.onDemo(t.value, t.note)
        : options.onMissing('demo-excluded', t.note);
  }
}

/** `renderTrusted` para superfícies oficiais: `demo` não é sequer aceito no tipo. */
export function renderOfficial<T, R>(
  t: Official<T>,
  options: Omit<RenderTrustedOptions<T, R>, 'onDemo'>,
): R {
  return renderTrusted(t as Trusted<T>, options);
}

/**
 * Formata um indicador oficial, ou devolve o rótulo do estado sem valor.
 *
 * É o atalho que substitui `formatCurrency(x.value)`. Note que continua sendo
 * impossível chamar `formatCurrency` direto num `Official<number>`: o tipo não
 * é `number`, e `missing`/`error` não possuem `.value`.
 */
export function formatOfficial(
  t: Official<number>,
  format: (value: number) => string,
): string {
  return renderOfficial(t, {
    onValue: (value) => format(value),
    onMissing: () => TRUST_FALLBACK_LABEL.missing,
    onError: () => TRUST_FALLBACK_LABEL.error,
  });
}

/** Rótulo curto do estado, para selos de proveniência na interface. */
export function trustBadge(t: Trusted<unknown>): { label: string; tone: 'success' | 'info' | 'neutral' | 'danger' | 'warning' } {
  switch (t.trust) {
    case 'live': return { label: 'Ao vivo', tone: 'success' };
    case 'derived': return { label: 'Calculado', tone: 'info' };
    case 'missing': return { label: 'Não apurado', tone: 'neutral' };
    case 'error': return { label: 'Dados indisponíveis', tone: 'danger' };
    case 'demo': return { label: 'Demonstração', tone: 'warning' };
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// Elegibilidade por ORIGEM da linha
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Origem do contrato — espelha `contracts.data_class` (migration 091).
 *
 *   live          origem validada; único elegível a métrica oficial
 *   demo          fixture/demonstração comprovada
 *   unclassified  origem ainda não validada
 */
export type ContractDataClass = 'live' | 'demo' | 'unclassified';

/**
 * Aplica a elegibilidade de ORIGEM sobre um indicador já apurado.
 *
 * A distinção que este módulo precisa manter clara: a qualidade da MEDIÇÃO e a
 * procedência da LINHA são coisas diferentes. O fixture de QA tem R$ 1,2M
 * genuinamente gravados no banco — o valor está medido. O que o desqualifica
 * para a carteira oficial não é a medição, é a origem.
 *
 * Por isso a classificação não contamina os campos do `TrustedContract`: eles
 * seguem dizendo o que a fonte diz, e é AQUI, na fronteira da agregação
 * oficial, que a origem passa a pesar. Assim o Quick Dossier continua podendo
 * exibir um contrato de demonstração — que é para isso que ele existe — sem que
 * um único centavo dele alcance a Executive Band ou o PDF.
 */
export function officialByOrigin<T>(
  value: Official<T>,
  dataClass: ContractDataClass,
): Official<T> {
  if (dataClass === 'live') return value;
  if (dataClass === 'demo') {
    return { trust: 'missing', reason: 'demo-excluded', note: 'contrato de demonstração' };
  }
  return {
    trust: 'missing',
    reason: 'unclassified-contract',
    note: 'origem do contrato ainda não validada',
  };
}

/** Só contratos `live` alimentam métrica de carteira. */
export const isOfficialOrigin = (dataClass: ContractDataClass): boolean => dataClass === 'live';
