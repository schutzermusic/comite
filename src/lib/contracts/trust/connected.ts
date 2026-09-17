/**
 * Operações conectadas — o estado das relações autoritativas do contrato.
 *
 * Lógica pura, sem JSX: o vitest deste repositório roda em `node` sem
 * transformador de JSX, então tudo que precisa de teste vive fora dos
 * componentes. É a mesma razão pela qual `chart-axis.ts` foi extraído de
 * `FuturisticCharts.tsx`.
 *
 * Nenhuma linha aqui cria fonte de verdade paralela: os números saem das
 * relações do próprio contrato, e a navegação entrega o assunto ao módulo que
 * o governa. Contratos orquestra; cada módulo continua dono do seu domínio.
 *
 * Três estados são deliberadamente distintos e nunca se confundem:
 *   · apurado           — a fonte respondeu (inclusive respondendo "nenhum")
 *   · não apurado       — não houve leitura desta relação neste contexto
 *   · indisponível/erro — a leitura falhou
 *   · não integrado     — a ligação não existe no produto (decisão de arquitetura)
 */

import { hasOfficialValue, isError, type Official } from './trusted';
import type { TrustedContract } from './read-model';
import { obligationBreakdown, missingDocuments, approvalRoute } from './signals';
import { MEASURED_STATUSES } from '../contract-service';

export type ConnectedOperationKey =
  | 'project' | 'tasks' | 'obligations' | 'measurement' | 'billing'
  | 'documents' | 'risks' | 'clauses' | 'approvals' | 'audit' | 'finance';

export type ConnectedTone = 'neutral' | 'warning' | 'danger' | 'success';

export type ConnectedRow = {
  readonly key: ConnectedOperationKey;
  readonly label: string;
  /** Módulo do Insight que É DONO deste domínio. */
  readonly owner: string;
  /** Estado resumido; `null` quando não pôde ser apurado. */
  readonly state: string | null;
  /** A leitura da fonte falhou — distinto de estado vazio. */
  readonly errored: boolean;
  /**
   * A ligação não existe no produto — distinto de "existe e está vazia".
   * Uma linha assim NUNCA exibe número: exibir R$ 0 sugeriria integração
   * existente com resultado zero, que é uma afirmação diferente.
   */
  readonly notIntegrated: boolean;
  /** Por que não há dado, quando é o caso. */
  readonly note: string | null;
  readonly tone: ConnectedTone;
};

/**
 * Contagem vinda de um módulo dono, lida fora do `TrustedContract`.
 *
 * `count: null` com `errored: false` significa "não consultado neste contexto";
 * `errored: true` significa "consultado e falhou". Zero é um valor apurado.
 */
export type ConnectedCount = {
  readonly count: number | null;
  readonly errored: boolean;
};

/**
 * Relações que vivem em tabelas de OUTROS módulos e por isso não fazem parte do
 * read model do contrato. Ausência do campo = não apurado, jamais zero.
 */
export type ConnectedContext = {
  /** `tasks.related_contract_id` — módulo Agenda & Tarefas. */
  readonly tasks?: ConnectedCount;
  /** `audit_logs` de `entity_type = 'contract'` — módulo Auditoria. */
  readonly auditEvents?: ConnectedCount;
};

const NOT_MEASURED = { count: null, errored: false } as const;

const countOf = (t: Official<readonly unknown[]>): number | null =>
  hasOfficialValue(t) ? t.value.length : null;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildConnectedRows(
  contract: TrustedContract,
  context: ConnectedContext = {},
): ConnectedRow[] {
  const obligations = obligationBreakdown(contract);
  const docs = missingDocuments(contract);
  const route = approvalRoute(contract);

  const billingCount = countOf(contract.billingEvents);
  const riskCount = countOf(contract.riskLinks);
  const docCount = countOf(contract.documents);
  const pendingDocs = hasOfficialValue(docs) ? docs.value.length : null;
  const pendingApprovals = hasOfficialValue(contract.approvals)
    ? contract.approvals.value.filter((a) => a.status !== 'approved').length
    : null;

  const tasks = context.tasks ?? NOT_MEASURED;
  const audit = context.auditEvents ?? NOT_MEASURED;

  const measuredCount = hasOfficialValue(contract.milestones)
    ? contract.milestones.value.filter((m) => MEASURED_STATUSES.includes(m.status)).length
    : 0;
  const definedObligations = countOf(contract.obligationDefinitions);
  const trackedObligations = countOf(contract.obligations);

  return [
    {
      key: 'project',
      label: 'Projeto',
      owner: 'Projetos',
      state: isError(contract.project)
        ? null
        : hasOfficialValue(contract.project)
          ? contract.project.value.codigo
          : 'Não vinculado',
      errored: isError(contract.project),
      notIntegrated: false,
      note: isError(contract.project) ? 'Falha ao ler o vínculo de projeto.' : null,
      tone: hasOfficialValue(contract.project) ? 'success' : 'warning',
    },
    {
      key: 'tasks',
      label: 'Tarefas',
      owner: 'Agenda & Tarefas',
      state: tasks.errored || tasks.count === null
        ? null
        : tasks.count === 0
          ? 'Nenhuma vinculada'
          : `${tasks.count} ${plural(tasks.count, 'tarefa', 'tarefas')}`,
      errored: tasks.errored,
      notIntegrated: false,
      note: tasks.errored ? 'Falha ao ler as tarefas vinculadas.' : null,
      tone: 'neutral',
    },
    {
      key: 'obligations',
      label: 'Obrigações',
      owner: 'Contratos',
      /*
        Dois níveis, e a linha diz qual está falando.

        `contract_obligation_definitions` é o que o contrato EXIGE;
        `contract_obligations` é o que está em acompanhamento operacional. Esta
        linha lia só a segunda e escrevia "Nenhuma mapeada" — enquanto a
        Prontidão, lendo a primeira, dizia "11 obrigações registradas" a três
        centímetros dali. As duas frases eram verdadeiras e a tela parecia
        mentir, porque nenhuma delas dizia de que nível estava falando.

        Quando há definição sem acompanhamento, o estado nomeia exatamente
        isso: o contrato está lido, a operação ainda não foi montada. É
        trabalho pendente, não irregularidade — daí o tom de atenção contido, e
        nunca `danger`.
      */
      state: definedObligations === null
        ? (hasOfficialValue(obligations)
          ? obligations.value.total === 0
            ? 'Nenhuma registrada'
            : `${obligations.value.overdue} ${plural(obligations.value.overdue, 'atrasada', 'atrasadas')} · ${obligations.value.open + obligations.value.dueSoon} ${plural(obligations.value.open + obligations.value.dueSoon, 'aberta', 'abertas')}`
          : null)
        : trackedObligations === null || trackedObligations === 0
          ? definedObligations === 0
            ? 'Nenhuma registrada'
            : `${definedObligations} ${plural(definedObligations, 'definida', 'definidas')} · 0 acompanhadas`
          : `${hasOfficialValue(obligations) ? obligations.value.overdue : 0} ${plural(hasOfficialValue(obligations) ? obligations.value.overdue : 0, 'atrasada', 'atrasadas')} · ${trackedObligations} ${plural(trackedObligations, 'acompanhada', 'acompanhadas')}`,
      errored: isError(contract.obligations) || isError(contract.obligationDefinitions),
      notIntegrated: false,
      note: isError(contract.obligations) || isError(contract.obligationDefinitions)
        ? 'Falha ao ler as obrigações.'
        : definedObligations !== null && definedObligations > 0 && (trackedObligations ?? 0) === 0
          ? 'As exigências do contrato estão definidas; o acompanhamento operacional ainda não foi montado.'
          : null,
      tone: hasOfficialValue(obligations) && obligations.value.overdue > 0
        ? 'danger'
        : definedObligations !== null && definedObligations > 0 && (trackedObligations ?? 0) === 0
          ? 'warning'
          : 'neutral',
    },
    {
      key: 'measurement',
      label: 'Medição',
      owner: 'Contratos',
      // Instrumentada em P2B: "nenhum marco" passou a ser um fato operacional.
      state: hasOfficialValue(contract.milestones)
        ? contract.milestones.value.length === 0
          ? 'Nenhum marco'
          : `${measuredCount} de ${contract.milestones.value.length} ${plural(contract.milestones.value.length, 'medido', 'medidos')}`
        : null,
      errored: isError(contract.milestones),
      notIntegrated: false,
      note: isError(contract.milestones) ? 'Falha ao ler os marcos de medição.' : null,
      tone: hasOfficialValue(contract.milestones) && contract.milestones.value.length === 0
        ? 'warning'
        : 'neutral',
    },
    {
      key: 'billing',
      label: 'Faturamento',
      owner: 'Contratos',
      // "Nenhum evento" é um estado APURADO — diferente de "Não apurado".
      state: billingCount === null ? null : billingCount === 0 ? 'Nenhum evento'
        : `${billingCount} ${plural(billingCount, 'evento', 'eventos')}`,
      errored: isError(contract.billingEvents),
      notIntegrated: false,
      note: isError(contract.billingEvents) ? 'Falha ao ler os eventos de faturamento.' : null,
      tone: billingCount === 0 ? 'warning' : 'neutral',
    },
    {
      key: 'documents',
      label: 'Documentos',
      owner: 'Contratos',
      state: docCount === null
        ? null
        : docCount === 0
          ? 'Nenhum registrado'
          : pendingDocs && pendingDocs > 0
            ? `${pendingDocs} ${plural(pendingDocs, 'pendente', 'pendentes')} de ${docCount}`
            : `${docCount} em conformidade`,
      errored: isError(contract.documents),
      notIntegrated: false,
      note: isError(contract.documents) ? 'Falha ao ler os documentos.' : null,
      tone: pendingDocs && pendingDocs > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'risks',
      label: 'Riscos',
      owner: 'Riscos',
      state: riskCount === null ? null : riskCount === 0 ? 'Nenhum vinculado'
        : `${riskCount} ${plural(riskCount, 'monitorado', 'monitorados')}`,
      errored: isError(contract.riskLinks),
      notIntegrated: false,
      note: isError(contract.riskLinks) ? 'Falha ao ler os riscos vinculados.' : null,
      tone: riskCount && riskCount > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'clauses',
      label: 'Cláusulas',
      owner: 'Contratos',
      /*
        "0 de 38 validadas" media uma fila que não existe mais.

        O par validada/não-validada nasceu quando toda leitura de máquina
        esperava aprovação individual. Com a governança por exceção (migration
        154) o normal é a cláusula extraída entrar em operação sem passar por
        ninguém; só a exceção marcada pela política pede decisão humana, e essa
        fila é a da aba Inteligência, não esta. Mantido, o texto acusava a
        equipe de 38 pendências inexistentes e pintava a linha de âmbar por
        isso.

        O que esta linha tem a dizer sobre cláusulas é quantas foram extraídas
        do documento — o acervo de origem. É um fato apurado, e fato apurado
        não é alerta.
      */
      state: hasOfficialValue(contract.clauses)
        ? contract.clauses.value.length === 0
          ? 'Nenhuma extraída'
          : `${contract.clauses.value.length} ${plural(contract.clauses.value.length, 'cláusula extraída', 'cláusulas extraídas')}`
        : null,
      errored: isError(contract.clauses),
      notIntegrated: false,
      note: isError(contract.clauses)
        ? 'Falha ao ler as cláusulas.'
        : 'Acervo de origem extraído do documento. O que exige decisão humana fica em Inteligência Contratual.',
      tone: 'neutral',
    },
    {
      key: 'approvals',
      label: 'Aprovações',
      owner: 'Contratos',
      state: pendingApprovals === null
        ? null
        : pendingApprovals === 0
          ? hasOfficialValue(route) ? 'Concluídas' : 'Nenhuma etapa'
          : `${pendingApprovals} em aberto`,
      errored: isError(contract.approvals),
      notIntegrated: false,
      note: isError(contract.approvals) ? 'Falha ao ler as etapas de aprovação.' : null,
      /**
       * Só uma rota REALMENTE concluída ganha tom de sucesso.
       *
       * Um contrato sem nenhuma etapa cadastrada não está "aprovado": está sem
       * controle de alçada. Pintar isso de verde é a mesma armadilha de "0
       * documentos → documentação em conformidade" corrigida em P1B.
       */
      tone: pendingApprovals === null
        ? 'neutral'
        : pendingApprovals > 0
          ? 'warning'
          : hasOfficialValue(route) ? 'success' : 'neutral',
    },
    {
      key: 'audit',
      label: 'Auditoria',
      owner: 'Auditoria',
      state: audit.errored || audit.count === null
        ? null
        : audit.count === 0
          ? 'Nenhum evento'
          : `${audit.count} ${plural(audit.count, 'evento', 'eventos')}`,
      errored: audit.errored,
      notIntegrated: false,
      note: audit.errored ? 'Falha ao ler o histórico de auditoria.' : null,
      tone: 'neutral',
    },
    {
      key: 'finance',
      label: 'Financeiro',
      owner: 'Financeiro',
      /**
       * Declarado como NÃO INTEGRADO, e não como "sem dado".
       *
       * `ledger_entry.contract_id` e `apar_title.contract_id` existem no schema
       * mas sem FK, e não há conciliação entre `contract_billing_events` e o
       * razão. Não é possível afirmar compromissos ou recebimentos por
       * contrato — e escrever R$ 0 aqui afirmaria que a integração existe e
       * que nada foi recebido, que é uma mentira diferente e pior.
       */
      state: null,
      errored: false,
      notIntegrated: true,
      note: 'A conciliação entre eventos de faturamento e o razão financeiro ainda não existe. Recebimentos por contrato não podem ser afirmados.',
      tone: 'neutral',
    },
  ];
}
