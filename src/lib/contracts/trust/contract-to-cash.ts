/**
 * Contract-to-Cash — a cadeia Contratado → Medido → Aprovado → Faturado → Recebido.
 *
 * Lógica pura, sem JSX (o vitest deste repositório roda em `node`).
 *
 * A regra que governa este arquivo: **um estágio só exibe número quando a
 * fonte o sustenta**. Dois dos cinco estágios hoje NÃO têm fonte, e cada um
 * falha por um motivo diferente — a distinção é o conteúdo principal do painel,
 * não uma nota de rodapé:
 *
 *   · MEDIDO    → INSTRUMENTADO em P2B (migration 092). `contract_milestones`
 *                 ganhou responsável, evidência, valor medido e vocabulário de
 *                 status; o estágio passa a somar o que os marcos afirmam ter
 *                 sido medido. Sem nenhum marco registrado o estágio volta a
 *                 dizer que não há registro — que agora é uma afirmação sobre
 *                 a operação, e não sobre o produto.
 *   · RECEBIDO  → segue sem fonte. Depende do razão financeiro:
 *                 `ledger_entry.contract_id` e `apar_title.contract_id`
 *                 existem sem FK e sem conciliação. (`not-integrated`)
 *
 * Escrever R$ 0 em RECEBIDO afirmaria que nada foi recebido — a mentira que
 * faz alguém cobrar um cliente que já pagou.
 */

import {
  derived, missing, hasOfficialValue, isError, isMissing, isOfficialOrigin,
  type Official,
} from './trusted';
import type { TrustedContract } from './read-model';
import { MEASURED_STATUSES } from '../contract-service';
import {
  resolveMeasuredAmount, type AcceptedMeasurementInput,
} from '@/lib/projects/measurements/measured-amount';
import type { ContractBillingEventRow, ContractMilestoneRow } from '../contract-service';

export type CashStageKey = 'contracted' | 'measured' | 'approved' | 'billed' | 'received';

/**
 * Por que um estágio está como está. `measured` aqui significa "apurado",
 * não confundir com o estágio MEDIDO da cadeia.
 */
export type CashStageState =
  | 'measured'
  | 'unmeasured'
  | 'error'
  | 'not-instrumented'
  | 'not-integrated';

export type CashStage = {
  readonly key: CashStageKey;
  readonly label: string;
  /** Valor do estágio. Sem `.value` quando não apurado — o compilador cobra. */
  readonly amount: Official<number>;
  /** Quantidade de registros que sustentam o valor. */
  readonly count: Official<number>;
  readonly state: CashStageState;
  /** Por que não há número, quando é o caso. */
  readonly note: string | null;
  /**
   * Fração do valor contratado, de 0 a 1 — só quando AMBAS as pontas foram
   * apuradas. `null` nunca vira 0: a barra desenha trilho tracejado.
   */
  readonly shareOfContracted: number | null;
};

const REALIZED_STATUS = ['pago', 'paid', 'billed', 'realizado', 'realized', 'faturado'];

/** Um evento conta como faturado quando a própria linha o afirma. */
export function isBilled(event: ContractBillingEventRow): boolean {
  if (event.realized_at) return true;
  if (event.paid_at) return true;
  return REALIZED_STATUS.includes((event.status ?? '').toLowerCase());
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

const share = (amount: Official<number>, contracted: Official<number>): number | null => {
  if (!hasOfficialValue(amount) || !hasOfficialValue(contracted)) return null;
  if (contracted.value <= 0) return null;
  return Math.min(amount.value / contracted.value, 1);
};

/**
 * A cadeia de um contrato.
 *
 * `milestones` é opcional porque o batch de carteira não a carrega — e não
 * carrega de propósito: a tabela não tem caminho de escrita, então buscá-la em
 * lote seria custo de rede para confirmar um vazio conhecido. Quando o dossiê
 * de um contrato a tiver em mãos, passa; o estágio segue declarando a lacuna de
 * instrumentação mesmo assim, porque a lacuna não é de linha, é de produto.
 */
export function contractToCash(
  contract: TrustedContract,
  /** Sobrescreve a seção do read model — o dossiê passa a sua própria leitura. */
  milestones?: Official<readonly ContractMilestoneRow[]>,
): CashStage[] {
  const contracted = contract.totalValue;

  const measuredStage = measuredStageFor(milestones ?? contract.milestones, contracted);

  // ── APROVADO ────────────────────────────────────────────────────────────
  // "Aprovado" é a etapa da cadeia de alçada, não um valor: o que se aprova é
  // o contrato, e o valor aprovado é o contratado quando a rota se completa.
  const approvals = contract.approvals;
  let approvedStage: CashStage;
  if (isError(approvals)) {
    approvedStage = {
      key: 'approved', label: 'Aprovado',
      amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
      state: 'error',
      note: 'A rota de aprovação não pôde ser lida.',
      shareOfContracted: null,
    };
  } else if (!hasOfficialValue(approvals) || approvals.value.length === 0) {
    approvedStage = {
      key: 'approved', label: 'Aprovado',
      amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
      state: 'unmeasured',
      note: 'Nenhuma etapa de alçada registrada. Sem rota, não há o que aprovar — e não há como afirmar que o contrato passou por aprovação.',
      shareOfContracted: null,
    };
  } else {
    const total = approvals.value.length;
    const approved = approvals.value.filter((a) => a.status === 'approved').length;
    const complete = approved === total;
    // O valor só é "aprovado" quando a rota INTEIRA se completou. Rota parcial
    // não aprova metade do contrato.
    const amount: Official<number> = complete && hasOfficialValue(contracted)
      ? derived(contracted.value, {
          rule: 'valor contratado, liberado pela rota de aprovação completa',
          from: ['contracts', 'contract_approvals'],
          coverage: { counted: approved, total },
        })
      : missing<number>('no-rows');
    approvedStage = {
      key: 'approved', label: 'Aprovado',
      amount,
      count: derived(approved, {
        rule: 'etapas de alçada aprovadas',
        from: ['contract_approvals'],
        coverage: { counted: approved, total },
      }),
      state: complete ? 'measured' : 'unmeasured',
      note: complete ? null : `Rota incompleta: ${approved} de ${total} etapa(s) aprovada(s).`,
      shareOfContracted: share(amount, contracted),
    };
  }

  // ── FATURADO ────────────────────────────────────────────────────────────
  const events = contract.billingEvents;
  let billedStage: CashStage;
  if (isError(events)) {
    billedStage = {
      key: 'billed', label: 'Faturado',
      amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
      state: 'error',
      note: 'Os eventos de faturamento não puderam ser lidos.',
      shareOfContracted: null,
    };
  } else if (!hasOfficialValue(events) || events.value.length === 0) {
    billedStage = {
      key: 'billed', label: 'Faturado',
      amount: missing<number>('no-rows'), count: missing<number>('no-rows'),
      state: 'unmeasured',
      note: 'Nenhum evento de faturamento registrado. Zero eventos não é R$ 0 faturado: é ausência de registro.',
      shareOfContracted: null,
    };
  } else {
    const billedRows = events.value.filter(isBilled);
    // Aqui zero É um valor apurado: os eventos existem e nenhum foi realizado.
    const total = billedRows.reduce((sum, e) => sum + num(e.realized_amount ?? e.amount), 0);
    const amount = derived(total, {
      rule: 'soma dos eventos de faturamento realizados',
      from: ['contract_billing_events'],
      coverage: { counted: billedRows.length, total: events.value.length },
    });
    billedStage = {
      key: 'billed', label: 'Faturado',
      amount,
      count: derived(billedRows.length, {
        rule: 'eventos de faturamento realizados',
        from: ['contract_billing_events'],
        coverage: { counted: billedRows.length, total: events.value.length },
      }),
      state: 'measured',
      note: null,
      shareOfContracted: share(amount, contracted),
    };
  }

  return [
    {
      key: 'contracted',
      label: 'Contratado',
      amount: contracted,
      count: hasOfficialValue(contracted) ? derived(1, { rule: 'o próprio contrato', from: ['contracts'] }) : missing<number>('no-rows'),
      state: hasOfficialValue(contracted) ? 'measured' : isError(contracted) ? 'error' : 'unmeasured',
      note: isMissing(contracted) ? 'O valor contratado não está registrado na linha do contrato.' : null,
      shareOfContracted: hasOfficialValue(contracted) ? 1 : null,
    },
    measuredStage,
    approvedStage,
    billedStage,
    RECEIVED_STAGE,
  ];
}

/**
 * MEDIDO não depende do contrato — e essa é justamente a afirmação.
 *
 * A lacuna não é "este contrato não foi medido": é que nenhum contrato pode
 * ser, porque o produto não escreve `contract_milestones`. Por isso o estágio é
 * construído fora do laço do contrato e não muda de aparência entre um e outro.
 * A contagem de marcos concluídos aparece quando alguém os tiver (via seed ou
 * carga direta), mas o VALOR medido segue não afirmável.
 */
function measuredStageFor(
  milestones: Official<readonly ContractMilestoneRow[]> | undefined,
  contracted: Official<number>,
): CashStage {
  const base = { key: 'measured' as const, label: 'Medido' };

  // Sem a seção em mãos (chamador que não a carregou) o estágio não afirma nada.
  if (!milestones) {
    return {
      ...base,
      amount: missing<number>('no-rows'),
      count: missing<number>('no-rows'),
      state: 'unmeasured',
      note: 'Os marcos deste recorte não foram carregados.',
      shareOfContracted: null,
    };
  }

  if (isError(milestones)) {
    return {
      ...base,
      amount: missing<number>('no-rows'),
      count: missing<number>('no-rows'),
      state: 'error',
      note: 'Os marcos de medição não puderam ser lidos.',
      shareOfContracted: null,
    };
  }

  if (!hasOfficialValue(milestones) || milestones.value.length === 0) {
    return {
      ...base,
      amount: missing<number>('no-rows'),
      count: missing<number>('no-rows'),
      state: 'unmeasured',
      note: 'Nenhum marco de medição registrado. Zero marcos não é R$ 0 medido: é ausência de registro.',
      shareOfContracted: null,
    };
  }

  /**
   * Só marco que a linha AFIRMA medido entra na soma — `measured` ou
   * `approved`, conforme o CHECK da migration 092. Um marco `pending` tem
   * `billing_amount` previsto, e somá-lo apresentaria previsão como medição.
   */
  const measured = milestones.value.filter((m) => MEASURED_STATUSES.includes(m.status));

  /*
    ─── A PRECEDÊNCIA DO VALOR MEDIDO (Fase 6, §12 e §68) ───────────────────

    Antes da Fase 6 esta linha era `m.measured_amount ?? m.billing_amount`, e
    o `??` era o defeito: `billing_amount` é o valor PREVISTO no contrato.
    Um marco marcado como medido mas sem valor apurado contribuía com o
    previsto dele, e o painel apresentava previsão como apuração. A diferença
    aparecia na conversa com o cliente sobre quanto já havia sido medido.

    A regra agora mora em `resolveMeasuredAmount`, e é uma só: medição
    canônica aceita → `measured_amount` legado → UNKNOWN. Nunca
    `billing_amount`, nem como último recurso.

    `accepted` vem vazio nesta leitura porque a soma de carteira ainda lê
    apenas `contract_milestones`; a medição canônica entra por marco, via
    `contract_milestone_measured_amount`. O que MUDOU aqui, e é o ponto, é que
    marco sem valor apurado agora contribui com NADA em vez de contribuir com
    o previsto — e o estágio informa quantos marcos ficaram sem apuração.
  */
  const noAccepted: readonly AcceptedMeasurementInput[] = [];
  /*
    Os valores vão CRUS. O `num` local deste arquivo coage ausência para 0, e
    passá-lo aqui apagaria a distinção entre "medido e deu zero" e "não
    apurado" logo na entrada do resolvedor — que é a distinção inteira.
  */
  const resolved = measured.map((m) => resolveMeasuredAmount({
    accepted: noAccepted,
    legacyMeasuredAmount: m.measured_amount ?? null,
    billingAmount: m.billing_amount ?? null,
  }));

  const apurados = resolved.filter((r) => r.amount !== null);
  const total = apurados.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const semApuracao = measured.length - apurados.length;

  /*
    Cobertura conta os marcos APURADOS, não os marcados como medidos. Contar
    os marcados apresentaria "8 de 10" para uma soma que só três sustentam.
  */
  const amount = derived(total, {
    rule: 'soma do valor APURADO dos marcos medidos (nunca o previsto)',
    from: ['contract_milestones'],
    coverage: { counted: apurados.length, total: milestones.value.length },
  });

  return {
    ...base,
    amount,
    count: derived(measured.length, {
      rule: 'marcos medidos ou aprovados',
      from: ['contract_milestones'],
      coverage: { counted: measured.length, total: milestones.value.length },
    }),
    state: 'measured',
    note: measured.length === 0
      ? `Nenhum dos ${milestones.value.length} marco(s) registrados foi medido ainda.`
      : semApuracao > 0
        ? `${semApuracao} marco(s) marcado(s) como medido(s) não têm valor apurado. `
          + 'O previsto em contrato não entra nesta soma.'
        : null,
    shareOfContracted: share(amount, contracted),
  };
}

/**
 * RECEBIDO é uma constante, e essa é a afirmação.
 *
 * Não há cálculo possível: nenhuma consulta é feita, nenhum valor é estimado, e
 * o estágio não muda de aparência conforme o contrato. É o mesmo tratamento que
 * a linha "Financeiro · Não integrado" recebe nas operações conectadas, pela
 * mesma razão.
 */
const RECEIVED_STAGE: CashStage = {
  key: 'received',
  label: 'Recebido',
  amount: missing<number>('not-integrated'),
  count: missing<number>('not-integrated'),
  state: 'not-integrated',
  note: 'O razão financeiro não está conciliado com os eventos de faturamento. Recebimento por contrato não pode ser afirmado por este módulo.',
  shareOfContracted: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// Carteira
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A cadeia somada sobre a carteira.
 *
 * Por padrão a fronteira de origem é aplicada aqui, na agregação: contrato de
 * demonstração não entra em nenhum estágio, e é isso que protege a métrica
 * oficial. Um contrato individual continua exibindo a própria cadeia no
 * dossiê, inclusive sendo demo.
 */
/**
 * MEDIDO somado na carteira.
 *
 * Diferente dos demais agregados porque a medição não é derivada de outro
 * estágio: ela soma as linhas de `contract_milestones` de cada contrato do
 * recorte, preservando a distinção entre "nenhum marco registrado" e "marcos
 * registrados, nenhum medido".
 */
function aggregateMeasured(
  contracts: readonly TrustedContract[],
  contracted: Official<number>,
): CashStage {
  const stages = contracts.map((c) => measuredStageFor(c.milestones, c.totalValue));
  const errored = stages.some((s) => s.state === 'error');
  const withValue = stages.filter((s) => hasOfficialValue(s.amount));

  if (withValue.length === 0) {
    return {
      key: 'measured', label: 'Medido',
      amount: missing<number>('no-rows'),
      count: missing<number>('no-rows'),
      state: errored ? 'error' : 'unmeasured',
      note: errored
        ? 'Os marcos de medição não puderam ser lidos.'
        : 'Nenhum marco de medição registrado no recorte. Zero marcos não é R$ 0 medido.',
      shareOfContracted: null,
    };
  }

  const total = withValue.reduce(
    (sum, stage) => sum + (hasOfficialValue(stage.amount) ? stage.amount.value : 0), 0);
  const count = stages.reduce(
    (sum, stage) => sum + (hasOfficialValue(stage.count) ? stage.count.value : 0), 0);
  const amount = derived(total, {
    rule: 'soma dos marcos medidos da carteira',
    from: ['contract_milestones'],
    coverage: { counted: withValue.length, total: contracts.length },
  });

  return {
    key: 'measured', label: 'Medido',
    amount,
    count: derived(count, { rule: 'marcos medidos ou aprovados', from: ['contract_milestones'] }),
    state: 'measured',
    note: null,
    shareOfContracted: share(amount, contracted),
  };
}

export function portfolioToCash(
  contracts: readonly TrustedContract[],
  options: { officialOnly?: boolean } = {},
): CashStage[] {
  // `officialOnly: false` serve às abas operacionais, que respeitam o escopo
  // escolhido pelo usuário e rotulam a origem do recorte na própria tela. O
  // padrão continua sendo a fronteira oficial, para que qualquer chamador novo
  // herde a regra restritiva sem precisar conhecê-la.
  const official = options.officialOnly === false
    ? [...contracts]
    : contracts.filter((c) => isOfficialOrigin(c.dataClass));

  const sum = (pick: (c: TrustedContract) => Official<number>) => {
    let total = 0;
    let counted = 0;
    let errored = false;
    for (const c of official) {
      const v = pick(c);
      if (isError(v)) { errored = true; continue; }
      if (hasOfficialValue(v)) { total += v.value; counted += 1; }
    }
    return { total, counted, errored };
  };

  const contracted = sum((c) => c.totalValue);
  const contractedAmount: Official<number> = contracted.counted > 0
    ? derived(contracted.total, {
        rule: 'soma do valor contratado da carteira oficial',
        from: ['contracts'],
        coverage: { counted: contracted.counted, total: official.length },
      })
    : missing<number>(official.length === 0 ? 'demo-excluded' : 'no-rows');

  const perContract = official.map((c) => contractToCash(c));
  const stageOf = (key: CashStageKey) =>
    perContract.map((stages) => stages.find((s) => s.key === key)!).filter(Boolean);

  const aggregate = (key: CashStageKey, label: string): CashStage => {
    const stages = stageOf(key);
    const withValue = stages.filter((s) => hasOfficialValue(s.amount));
    const errored = stages.some((s) => s.state === 'error');
    if (withValue.length === 0) {
      // Nenhum contrato sustenta o estágio — preserva o motivo quando ele é
      // único, para não achatar "não instrumentado" em "sem registro".
      const template = stages[0];
      return {
        key, label,
        amount: missing<number>(
          template?.state === 'not-instrumented' ? 'not-instrumented'
            : template?.state === 'not-integrated' ? 'not-integrated'
            : errored ? 'no-rows' : 'no-rows',
        ),
        count: missing<number>('no-rows'),
        state: template?.state ?? 'unmeasured',
        note: template?.note ?? null,
        shareOfContracted: null,
      };
    }
    const total = withValue.reduce(
      (s, stage) => s + (hasOfficialValue(stage.amount) ? stage.amount.value : 0), 0);
    const count = stages.reduce(
      (s, stage) => s + (hasOfficialValue(stage.count) ? stage.count.value : 0), 0);
    const amount = derived(total, {
      rule: `soma do estágio "${label}" na carteira oficial`,
      from: ['contracts', 'contract_approvals', 'contract_billing_events'],
      coverage: { counted: withValue.length, total: official.length },
    });
    return {
      key, label, amount,
      count: derived(count, { rule: `registros do estágio "${label}"`, from: ['contract_billing_events', 'contract_approvals'] }),
      state: 'measured',
      note: null,
      shareOfContracted: share(amount, contractedAmount),
    };
  };

  return [
    {
      key: 'contracted', label: 'Contratado',
      amount: contractedAmount,
      count: derived(official.length, { rule: 'contratos da carteira oficial', from: ['contracts'] }),
      state: contracted.counted > 0 ? 'measured' : 'unmeasured',
      note: official.length === 0 ? 'Nenhum contrato de origem validada na carteira.' : null,
      shareOfContracted: hasOfficialValue(contractedAmount) ? 1 : null,
    },
    aggregateMeasured(official, contractedAmount),
    aggregate('approved', 'Aprovado'),
    aggregate('billed', 'Faturado'),
    RECEIVED_STAGE,
  ];
}
