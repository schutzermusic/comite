/**
 * Prontidão de entrada — o que já foi REGISTRADO num contrato e o que falta.
 *
 * Este modelo responde a uma pergunta operacional ("o que ainda preciso
 * registrar neste contrato?") e a NENHUMA pergunta de conformidade. A distinção
 * é a razão de o arquivo existir e governa cada decisão abaixo.
 *
 * Um contrato sem obrigações registradas não está em falta com nada: pode ser
 * um contrato que genuinamente não tem obrigações a acompanhar, pode ser um
 * contrato cuja carga ainda não terminou, pode ser um contrato de escopo tão
 * simples que ninguém jamais registrará uma. Tratar essa ausência como
 * violação transformaria a tela de entrada num painel de acusação contra quem
 * acabou de cadastrar o contrato — e ensinaria a equipe a registrar linhas
 * vazias só para apagar alertas, que é como um controle destrói o próprio dado
 * que deveria proteger.
 *
 * Por isso não existe nota, percentual de conformidade nem semáforo vermelho
 * aqui. Existe uma lista do que está registrado, do que não está, e do que não
 * pôde ser lido — três estados que a interface nunca confunde.
 *
 * Lógica pura, sem JSX e sem I/O: o vitest deste repositório roda em `node`,
 * pela mesma razão que `connected.ts` e `signals.ts` vivem fora dos
 * componentes.
 */

import { hasOfficialValue, isError, type Official } from './trusted';
import type { TrustedContract } from './read-model';

export type OnboardingStepKey =
  | 'identity'
  | 'project'
  | 'documents'
  | 'clauses'
  | 'obligations'
  | 'milestones'
  | 'approvals'
  | 'risks';

/**
 * O estado de um passo.
 *
 * Nota sobre alcance: hoje `section()` no read model devolve `live([])` para
 * uma relação sem entrada no lote, de modo que `unknown` não é produzido pelo
 * caminho atual. O estado existe porque `Official<T>` admite `missing`, e
 * qualquer leitura parcial futura cairá nele — tratá-lo como `pending` faria a
 * lista afirmar "falta registrar" sobre algo que ninguém leu.
 *
 * `pending` e `unknown` são deliberadamente diferentes. `pending` significa que
 * a fonte respondeu e não há registro — ausência apurada, que convida a
 * registrar. `unknown` significa que esta relação não foi lida neste contexto —
 * e dizer "falta registrar" sobre algo que não se leu é inventar uma ausência.
 * É o mesmo princípio que separa "apurado" de "não apurado" em `connected.ts`.
 */
export type OnboardingStepState =
  | 'complete'
  | 'pending'
  | 'unknown'
  | 'errored'
  | 'not_applicable';

export type OnboardingStep = {
  readonly key: OnboardingStepKey;
  readonly label: string;
  /** O módulo do Insight que É DONO deste domínio. Contratos apenas orquestra. */
  readonly owner: string;
  readonly state: OnboardingStepState;
  /**
   * O que foi encontrado, em linguagem de negócio. `null` quando não há o que
   * dizer além do próprio estado.
   */
  readonly detail: string | null;
  /**
   * Este passo entra na contagem de "essencial para operar".
   *
   * Só identidade, projeto e documento são essenciais — são o que torna o
   * contrato uma entidade operável e auditável. Cláusulas, obrigações, marcos,
   * aprovações e riscos são instrumentação: valiosos, frequentemente ausentes
   * por motivo legítimo, e nunca requisito para o contrato existir.
   */
  readonly essential: boolean;
};

export type OnboardingReadiness = {
  readonly steps: readonly OnboardingStep[];
  /** Passos essenciais já registrados / total de essenciais. */
  readonly essentialComplete: number;
  readonly essentialTotal: number;
  /**
   * Todo passo essencial está registrado — o contrato é plenamente operável.
   *
   * NÃO significa "conforme", "completo" nem "aprovado". Significa apenas que
   * identidade, projeto e documento existem.
   */
  readonly operable: boolean;
  /** Passos essenciais ainda sem registro, na ordem do fluxo. */
  readonly missingEssential: readonly OnboardingStepKey[];
  /** Alguma leitura falhou — a lista está incompleta por incidente, não por vazio. */
  readonly hasErrors: boolean;
};

/** Campos de identidade que um contrato operacional precisa ter preenchidos. */
export type IdentityGap = {
  readonly field: string;
  readonly label: string;
};

/**
 * Traduz um `Official<lista>` em estado de passo.
 *
 * Uma lista lida e vazia é `pending`; uma lista não lida é `unknown`; uma
 * leitura que falhou é `errored`. Em nenhum caminho uma ausência de leitura
 * vira ausência de registro.
 */
function stateOfList(
  official: Official<readonly unknown[]>,
  predicate: (rows: readonly unknown[]) => boolean = (rows) => rows.length > 0,
): OnboardingStepState {
  if (isError(official)) return 'errored';
  if (!hasOfficialValue(official)) return 'unknown';
  return predicate(official.value) ? 'complete' : 'pending';
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Campos de identidade ausentes num contrato.
 *
 * O que está aqui é o que torna um contrato IDENTIFICÁVEL e AUDITÁVEL: quem é
 * a contraparte, qual o número, de que tipo é, quando vale e quanto vale.
 * `monthly_value`, `payment_terms` e `scope_summary` ficam fora de propósito —
 * são frequentemente inaplicáveis (um contrato de valor fechado não tem valor
 * mensal) e exigi-los ensinaria a preencher campo com ruído.
 */
export function identityGaps(contract: TrustedContract): readonly IdentityGap[] {
  const gaps: IdentityGap[] = [];
  const absent = (o: Official<unknown>) => !hasOfficialValue(o);

  if (absent(contract.counterparty)) gaps.push({ field: 'counterparty_name', label: 'Contraparte' });
  if (absent(contract.contractType)) gaps.push({ field: 'contract_type', label: 'Tipo de contrato' });
  if (absent(contract.startDate)) gaps.push({ field: 'start_date', label: 'Início da vigência' });
  if (absent(contract.endDate)) gaps.push({ field: 'end_date', label: 'Fim da vigência' });
  if (absent(contract.totalValue)) gaps.push({ field: 'total_value', label: 'Valor contratual' });
  if (absent(contract.ownerUserId)) gaps.push({ field: 'owner_user_id', label: 'Responsável interno' });

  return gaps;
}

/**
 * Constrói a lista de prontidão de um contrato.
 *
 * `riskApplicable` decide se o passo de riscos aparece como pendente ou como
 * não aplicável. Vem de fora — do nível de risco DECLARADO no contrato — e não
 * de inferência sobre valor ou prazo: decidir sozinho que um contrato "deveria"
 * ter risco registrado seria exatamente a inferência que este módulo não faz.
 */
export function buildOnboardingReadiness(contract: TrustedContract): OnboardingReadiness {
  const gaps = identityGaps(contract);

  const identityState: OnboardingStepState = gaps.length === 0 ? 'complete' : 'pending';

  /*
    Projeto vem de `contract.project`, não de `projectLinks`.

    `contracts.project_id` e `contract_project_links` coexistem e AMBOS são
    vínculos reais — o read model já resolve os dois. Ler só a tabela de
    vínculos reportava "nenhum projeto" justamente para o contrato vinculado
    no cadastro, que grava a coluna.
  */
  const projectState: OnboardingStepState = isError(contract.project)
    ? 'errored'
    : hasOfficialValue(contract.project) ? 'complete' : 'pending';
  const documentsState = stateOfList(contract.documents);

  /*
    Cláusulas: uma proposta de IA pendente NÃO conta como registrada. Ela é
    leitura de máquina aguardando decisão humana, e contá-la como cláusula do
    contrato daria por concluído justamente o passo — a revisão — que dá valor
    à extração.
  */
  const clausesState = stateOfList(
    contract.clauses,
    (rows) => (rows as readonly { review_status?: string | null; ai_flagged?: boolean | null }[])
      .some((c) => !c.ai_flagged || c.review_status === 'validated'),
  );

  /**
   * A prontidão conta a obrigação ESTRUTURADA, não a lista de tarefas antiga.
   *
   * A lista antiga virou somente-leitura na Fase 3, e continuar contando por
   * ela faria a prontidão dizer "registrado" para um contrato que só tem
   * anotações — e "nada registrado" para um que tem a obrigação contratual
   * bem definida. As duas estão erradas, e em direções opostas.
   */
  const obligationsState = stateOfList(contract.obligationDefinitions);
  const milestonesState = stateOfList(contract.milestones);
  const approvalsState = stateOfList(contract.approvals);

  const riskApplicable = contract.riskLevel === 'high';
  const riskLinksState = stateOfList(contract.riskLinks);
  const risksState: OnboardingStepState =
    riskLinksState === 'complete' ? 'complete'
      : riskApplicable ? riskLinksState
        : riskLinksState === 'errored' ? 'errored'
          : 'not_applicable';

  const countOf = (o: Official<readonly unknown[]>) => (hasOfficialValue(o) ? o.value.length : null);

  const docCount = countOf(contract.documents);
  const oblCount = countOf(contract.obligationDefinitions);
  const msCount = countOf(contract.milestones);
  const apprCount = countOf(contract.approvals);
  const riskCount = countOf(contract.riskLinks);

  const validatedClauses = hasOfficialValue(contract.clauses)
    ? (contract.clauses.value as readonly { review_status?: string | null; ai_flagged?: boolean | null }[])
        .filter((c) => !c.ai_flagged || c.review_status === 'validated').length
    : null;
  const pendingProposals = hasOfficialValue(contract.clauses)
    ? (contract.clauses.value as readonly { review_status?: string | null; ai_flagged?: boolean | null }[])
        .filter((c) => c.ai_flagged && (c.review_status === 'draft' || c.review_status === 'in_review')).length
    : 0;

  const steps: readonly OnboardingStep[] = [
    {
      key: 'identity',
      label: 'Identidade do contrato',
      owner: 'Contratos',
      state: identityState,
      detail: gaps.length === 0
        ? 'Contraparte, tipo, vigência, valor e responsável registrados'
        : `Falta registrar: ${gaps.map((g) => g.label).join(', ')}`,
      essential: true,
    },
    {
      key: 'project',
      label: 'Projeto vinculado',
      owner: 'Projetos',
      state: projectState,
      detail: projectState === 'complete'
        ? (hasOfficialValue(contract.project) ? `Vinculado a ${contract.project.value.codigo}` : 'Vínculo registrado')
        : projectState === 'pending' ? 'Nenhum projeto vinculado a este contrato'
          : null,
      essential: true,
    },
    {
      key: 'documents',
      label: 'Documento original',
      owner: 'Documentos',
      state: documentsState,
      detail: docCount === null ? null
        : docCount === 0 ? 'Nenhum documento anexado'
          : `${docCount} ${plural(docCount, 'documento anexado', 'documentos anexados')}`,
      essential: true,
    },
    {
      key: 'clauses',
      label: 'Cláusulas revisadas',
      owner: 'Contratos',
      state: clausesState,
      detail: validatedClauses === null ? null
        : validatedClauses === 0
          ? (pendingProposals > 0
            ? `${pendingProposals} ${plural(pendingProposals, 'proposta aguardando revisão', 'propostas aguardando revisão')}`
            : 'Nenhuma cláusula registrada')
          : `${validatedClauses} ${plural(validatedClauses, 'cláusula registrada', 'cláusulas registradas')}`
            + (pendingProposals > 0 ? ` · ${pendingProposals} aguardando revisão` : ''),
      essential: false,
    },
    {
      key: 'obligations',
      label: 'Obrigações',
      owner: 'Contratos',
      state: obligationsState,
      detail: oblCount === null ? null
        : oblCount === 0 ? 'Nenhuma obrigação registrada'
          : `${oblCount} ${plural(oblCount, 'obrigação registrada', 'obrigações registradas')}`,
      essential: false,
    },
    {
      key: 'milestones',
      label: 'Marcos e medições',
      owner: 'Contratos',
      state: milestonesState,
      detail: msCount === null ? null
        : msCount === 0 ? 'Nenhum marco registrado'
          : `${msCount} ${plural(msCount, 'marco registrado', 'marcos registrados')}`,
      essential: false,
    },
    {
      key: 'approvals',
      label: 'Rota de aprovação',
      owner: 'Aprovações',
      state: approvalsState,
      detail: apprCount === null ? null
        : apprCount === 0 ? 'Nenhuma etapa de aprovação registrada'
          : `${apprCount} ${plural(apprCount, 'etapa registrada', 'etapas registradas')}`,
      essential: false,
    },
    {
      key: 'risks',
      label: 'Riscos vinculados',
      owner: 'Riscos',
      state: risksState,
      detail: risksState === 'not_applicable'
        ? 'Contrato não classificado como alto risco'
        : riskCount === null ? null
          : riskCount === 0 ? 'Nenhum risco vinculado'
            : `${riskCount} ${plural(riskCount, 'risco vinculado', 'riscos vinculados')}`,
      essential: false,
    },
  ];

  const essentials = steps.filter((s) => s.essential);
  const essentialComplete = essentials.filter((s) => s.state === 'complete').length;

  return {
    steps,
    essentialComplete,
    essentialTotal: essentials.length,
    operable: essentialComplete === essentials.length,
    missingEssential: essentials.filter((s) => s.state !== 'complete').map((s) => s.key),
    hasErrors: steps.some((s) => s.state === 'errored'),
  };
}
