/**
 * Risk & Clause Intelligence.
 *
 * Lógica pura, sem JSX.
 *
 * P2B instrumentou `contract_clauses` e `contract_penalties`: as duas ganharam
 * caminho de escrita, proveniência documental, efeito contratual e estado de
 * revisão humana. As três capacidades passam a falhar — quando falham — pelo
 * mesmo motivo operacional: ninguém registrou ainda. Todas são acionáveis.
 *
 * O que este módulo continua NÃO fazendo: inferir cláusula. Nada aqui deriva
 * cláusula de texto, de tipo de contrato ou de padrão de mercado. `ai_flagged`
 * existe na linha e é sempre `false` no registro manual — é o campo que, no dia
 * em que houver extração automática, separará o que a máquina propôs do que
 * uma pessoa afirmou. `review_status` separa registrado de validado.
 *
 * Uma ressalva de leitura que a interface precisa carregar: a RLS de 006 exige
 * `contracts.view_penalties` para LER penalidades. Sem a permissão o retorno é
 * vazio e sem erro — indistinguível de "não há penalidade".
 */

import { hasOfficialValue, isError, isOfficialOrigin } from './trusted';
import { PENDING_REVIEW } from '../contract-service';
import type { TrustedContract } from './read-model';
import type { ContractClauseRow, ContractPenaltyRow, ContractRiskDetail } from '../contract-service';

export type CapabilityState =
  /** Existe fonte e existe caminho de escrita; há dado. */
  | 'available'
  /** Existe fonte e caminho de escrita; ainda não há dado. */
  | 'no-records'
  /**
   * A tabela existe, mas nada no produto escreve nela.
   *
   * Nenhuma capacidade está neste estado desde P2B. O valor permanece no tipo
   * porque a distinção continua valendo — e porque removê-lo apagaria a
   * diferença entre "ninguém registrou" e "não há como registrar" no dia em
   * que um domínio novo aparecer nessa condição.
   */
  | 'not-instrumented'
  /** A leitura falhou. */
  | 'error';

export type IntelligenceCapability = {
  readonly key: 'risks' | 'clauses' | 'penalties';
  readonly label: string;
  readonly state: CapabilityState;
  /** O que se pode afirmar hoje. */
  readonly summary: string;
  /** O que falta para a inteligência existir. `null` quando já existe. */
  readonly limitation: string | null;
  /** Existe ação no produto que resolve a lacuna? */
  readonly actionable: boolean;
  readonly count: number | null;
};

export type LinkedRiskEntry = {
  readonly riskId: string;
  readonly title: string;
  readonly category: string | null;
  readonly severity: string | null;
  readonly status: string | null;
  readonly contractId: string;
  readonly contractCode: string;
  /** Cláusula que originou o vínculo, quando houve uma. */
  readonly clauseId: string | null;
};

export type ClauseRiskIntelligence = {
  readonly capabilities: readonly IntelligenceCapability[];
  readonly risks: readonly LinkedRiskEntry[];
  readonly clauses: readonly ContractClauseRow[];
  /**
   * Propostas de IA aguardando decisão humana.
   *
   * Subconjunto de `clauses` — não uma lista paralela: a proposta VIVE em
   * `contract_clauses` desde que nasce, marcada por `ai_flagged` e
   * `review_status`. Manter dois lugares faria a fila de revisão divergir do
   * registro.
   */
  readonly pendingProposals: readonly ContractClauseRow[];
  readonly penalties: readonly ContractPenaltyRow[];
  readonly erroredContracts: readonly string[];
  readonly coverage: { readonly counted: number; readonly total: number };
};

/**
 * `clauses` é opcional e virá vazio na prática — o parâmetro existe para que o
 * dia em que houver importador de cláusulas o painel já saiba exibi-las, sem
 * que ninguém precise reabrir este arquivo para "ligar" a inteligência.
 */
export function buildClauseRiskIntelligence(
  contracts: readonly TrustedContract[],
  /**
   * Cláusulas do recorte. Opcional: quando omitido, saem do próprio read model
   * de cada contrato — o parâmetro sobrevive para o dossiê passar a sua leitura.
   */
  clausesOverride?: readonly ContractClauseRow[],
  options: {
    officialOnly?: boolean;
    /**
     * Detalhes dos riscos, do módulo DONO (`risks`). Contratos guarda o
     * vínculo; o conteúdo do risco continua sendo de quem o governa.
     */
    riskDetails?: ReadonlyMap<string, ContractRiskDetail>;
  } = {},
): ClauseRiskIntelligence {
  const scope = options.officialOnly === false
    ? contracts
    : contracts.filter((c) => isOfficialOrigin(c.dataClass));

  const risks: LinkedRiskEntry[] = [];
  const errored: string[] = [];
  let counted = 0;

  for (const contract of scope) {
    if (isError(contract.riskLinks)) { errored.push(contract.code); continue; }
    counted += 1;
    if (!hasOfficialValue(contract.riskLinks)) continue;
    for (const link of contract.riskLinks.value) {
      const detail = options.riskDetails?.get(link.risk_id);
      risks.push({
        riskId: link.risk_id,
        // Sem o detalhe do módulo dono, o vínculo existe mas o conteúdo não
        // pode ser afirmado — mostrar o id é honesto; inventar título não.
        title: detail?.title ?? 'Risco vinculado (detalhe não lido)',
        category: detail?.category ?? null,
        severity: detail?.severity ?? null,
        status: detail?.status ?? null,
        contractId: contract.id,
        contractCode: contract.code,
        // P2B: quando o vínculo nasceu de uma cláusula, ela é a origem contratual.
        clauseId: link.clause_id ?? null,
      });
    }
  }

  const clauses = clausesOverride ?? scope.flatMap(
    (c) => (hasOfficialValue(c.clauses) ? [...c.clauses.value] : []),
  );
  const clausesErrored = scope.some((c) => isError(c.clauses));

  const penalties = scope.flatMap(
    (c) => (hasOfficialValue(c.penalties) ? [...c.penalties.value] : []),
  );
  const penaltiesErrored = scope.some((c) => isError(c.penalties));

  const validated = clauses.filter((c) => c.review_status === 'validated').length;
  const pending = clauses.filter((c) => PENDING_REVIEW.includes(c.review_status));
  const pendingReview = pending.length;
  // Só a proposta de MÁQUINA entra na fila de revisão assistida: uma cláusula
  // que uma pessoa transcreveu e ainda não validou é outro tipo de pendência.
  const pendingProposals = pending.filter((c) => c.ai_flagged);

  const capabilities: IntelligenceCapability[] = [
    {
      key: 'risks',
      label: 'Riscos vinculados',
      state: errored.length > 0 && risks.length === 0
        ? 'error'
        : risks.length > 0 ? 'available' : 'no-records',
      summary: risks.length > 0
        ? `${risks.length} risco(s) vinculado(s) ao recorte, mantidos no módulo de Riscos.`
        : 'Nenhum risco vinculado a contrato até agora.',
      limitation: risks.length > 0
        ? null
        : 'Sem vínculo, a exposição contratual não aparece na matriz de risco da organização.',
      actionable: true,
      count: risks.length,
    },
    {
      key: 'clauses',
      label: 'Cláusulas monitoradas',
      state: clausesErrored && clauses.length === 0
        ? 'error'
        : clauses.length > 0 ? 'available' : 'no-records',
      summary: clauses.length > 0
        ? `${clauses.length} cláusula(s) registrada(s) · ${validated} validada(s) · ${pendingReview} aguardando revisão.`
        : 'Nenhuma cláusula registrada até agora.',
      limitation: clauses.length > 0
        ? (pendingProposals.length > 0
            ? `${pendingProposals.length} proposta(s) de análise documental aguardando decisão humana. Proposta não é cláusula: nada aqui vale como verdade contratual antes de alguém validar.`
            : pendingReview > 0
              ? `${pendingReview} cláusula(s) ainda não passaram por revisão humana: registrar não é validar.`
              : null)
        : 'Sem cláusula registrada, não há como afirmar prazo de renovação, gatilho de multa ou condição de pagamento a partir do contrato.',
      // Instrumentada em P2B: existe caminho de registro manual estruturado.
      actionable: true,
      count: clauses.length,
    },
    {
      key: 'penalties',
      label: 'Penalidades',
      state: penaltiesErrored && penalties.length === 0
        ? 'error'
        : penalties.length > 0 ? 'available' : 'no-records',
      summary: penalties.length > 0
        ? `${penalties.length} penalidade(s) monitorada(s).`
        : 'Nenhuma penalidade registrada até agora.',
      limitation: penalties.length > 0
        ? null
        // A ressalva de permissão é parte da verdade: uma lista vazia aqui pode
        // significar "não há" OU "você não pode ver".
        : 'Sem penalidade registrada, a exposição a multa não pode ser afirmada. Esta lista também aparece vazia para quem não tem a permissão contracts.view_penalties.',
      actionable: true,
      count: penalties.length,
    },
  ];

  return {
    capabilities,
    risks,
    clauses,
    pendingProposals,
    penalties,
    erroredContracts: errored,
    coverage: { counted, total: scope.length },
  };
}
