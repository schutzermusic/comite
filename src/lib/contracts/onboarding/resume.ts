/**
 * Continuidade de um cadastro de contrato já iniciado.
 *
 * O DEFEITO QUE ESTE MÓDULO FECHA
 *
 * O primeiro contrato real entrou pelo fluxo documento-primeiro, o documento
 * foi preservado, a leitura foi concluída e o cadastro ficou aguardando as
 * decisões que só uma pessoa pode tomar (contraparte ambígua, classificação de
 * risco, responsável interno, projeto). Quando a tela foi fechada, porém, não
 * havia caminho de produto para voltar àquele cadastro: a entrada existia,
 * durável, no banco — e a interface se comportava como se não existisse. A
 * única saída visível era enviar o PDF outra vez, o que criaria uma segunda
 * leitura do mesmo documento e um segundo cadastro do mesmo contrato.
 *
 * O ESTADO JÁ É DURÁVEL
 *
 * Nada precisa ser criado para resolver isso. `contract_onboarding_intakes`
 * (migration 166) já guarda o documento (`file_path`, `content_sha256`), a
 * leitura estruturada (`structured_result`), a contagem de exceções e o
 * vínculo com o contrato canônico quando ele passa a existir (`contract_id`).
 * Retomar é LER esse estado e reconstruir a tela — não recomputar, não
 * reenviar, não reinterpretar. Por isso este módulo é puro: ele classifica e
 * formata o que já foi persistido, e não fala com o banco nem com provedor
 * algum.
 *
 * O CICLO DE VIDA NÃO É BORRADO
 *
 * "Leitura em andamento", "requer sua atenção" e "leitura não concluída" são
 * três situações diferentes, com ações diferentes, e continuam distintas aqui.
 * Um cadastro FAILED não é um cadastro REQUIRES_ATTENTION: um precisa de nova
 * tentativa de leitura ou de continuação manual; o outro precisa de decisão
 * humana sobre um resultado que já existe.
 */

import type { ContractOnboardingResult } from './document-first';

/**
 * Estados canônicos da entrada de contrato — exatamente os do CHECK da
 * migration 166. Escritos aqui uma vez para que nenhuma tela invente um
 * estado que o banco não aceita.
 */
export const CONTRACT_INTAKE_STATUSES = [
  'RECEIVED', 'QUEUED', 'READING', 'STRUCTURING',
  'READY', 'REQUIRES_ATTENTION', 'FAILED', 'REGISTERED', 'CANCELLED',
] as const;

/**
 * O estado canônico vive AQUI, e não no cliente do navegador: a rota de
 * listagem, a página de retomada e o componente da carteira leem todos do
 * mesmo módulo puro, sem que servidor precise importar código de cliente.
 */
export type ContractIntakeStatus = (typeof CONTRACT_INTAKE_STATUSES)[number];

/** A leitura ainda está correndo no servidor: não há o que o usuário decida agora. */
export const PROCESSING_INTAKE_STATUSES: readonly ContractIntakeStatus[] = [
  'RECEIVED', 'QUEUED', 'READING', 'STRUCTURING',
];

/**
 * A leitura terminou e o resultado estruturado existe: o cadastro pode ser
 * RETOMADO exatamente de onde parou, sem novo envio e sem nova leitura.
 */
export const RESUMABLE_INTAKE_STATUSES: readonly ContractIntakeStatus[] = ['READY', 'REQUIRES_ATTENTION'];

/**
 * A leitura não concluiu. O documento continua preservado, então existe
 * recuperação — nova tentativa de leitura ou cadastro manual — mas ela NÃO é
 * a mesma coisa que retomar um resultado pronto, e a interface não as mistura.
 */
export const RECOVERABLE_INTAKE_STATUSES: readonly ContractIntakeStatus[] = ['FAILED'];

/** Tudo que ainda não virou contrato nem foi descartado. É o que a carteira mostra. */
export const ACTIVE_INTAKE_STATUSES: readonly ContractIntakeStatus[] = [
  ...PROCESSING_INTAKE_STATUSES, ...RESUMABLE_INTAKE_STATUSES, ...RECOVERABLE_INTAKE_STATUSES,
];

export type IntakeContinuityKind = 'processing' | 'resume' | 'recover' | 'closed';

/** O mínimo que qualquer origem (lista ou dossiê) precisa expor para ser classificada. */
export interface IntakeContinuityInput {
  status: ContractIntakeStatus | string;
  contract_id: string | null;
}

/**
 * A classificação é feita pelo PAR (status, contract_id), nunca pelo status
 * sozinho.
 *
 * `contract_id` preenchido significa que o contrato canônico já nasceu — o
 * cadastro está concluído e não pode voltar a aparecer como "em andamento",
 * mesmo que algum estado intermediário fosse reescrito no futuro. É a mesma
 * invariante que o CHECK `coni_registration_coherent` grava no banco, aplicada
 * aqui em favor da segurança: contrato existente vence qualquer status.
 */
export function intakeContinuityKind(intake: IntakeContinuityInput): IntakeContinuityKind {
  if (intake.contract_id) return 'closed';
  const status = intake.status as ContractIntakeStatus;
  if (RESUMABLE_INTAKE_STATUSES.includes(status)) return 'resume';
  if (RECOVERABLE_INTAKE_STATUSES.includes(status)) return 'recover';
  if (PROCESSING_INTAKE_STATUSES.includes(status)) return 'processing';
  return 'closed';
}

/** Um cadastro aparece como "em andamento" enquanto não virou contrato nem foi descartado. */
export function isActiveIntake(intake: IntakeContinuityInput): boolean {
  return intakeContinuityKind(intake) !== 'closed';
}

/** Retomar de verdade — resultado estruturado pronto, esperando decisão humana. */
export function isResumableIntake(intake: IntakeContinuityInput): boolean {
  return intakeContinuityKind(intake) === 'resume';
}

/**
 * Linguagem da carteira, não do provedor.
 *
 * Nenhum destes textos nomeia modelo, provedor ou "inteligência artificial":
 * quem lê é quem cadastra o contrato, e o que interessa a essa pessoa é o
 * estado do SEU cadastro. `Apex` é o nome do sistema dentro do produto e é o
 * único agente citado.
 */
const STATE_LABELS: Record<ContractIntakeStatus, string> = {
  RECEIVED: 'Documento recebido — leitura na fila',
  QUEUED: 'Documento recebido — leitura na fila',
  READING: 'Leitura em andamento',
  STRUCTURING: 'Organizando o cadastro',
  READY: 'Leitura concluída — pronto para finalizar',
  REQUIRES_ATTENTION: 'Leitura concluída — requer sua atenção',
  FAILED: 'Leitura não concluída — documento preservado',
  REGISTERED: 'Contrato cadastrado',
  CANCELLED: 'Cadastro descartado',
};

/** Uma ação óbvia por situação. Retomar e recuperar não recebem o mesmo rótulo. */
const ACTION_LABELS: Record<IntakeContinuityKind, string> = {
  resume: 'Continuar cadastro',
  recover: 'Retomar leitura',
  processing: 'Acompanhar leitura',
  closed: 'Abrir contrato',
};

export interface ContractIntakeContinuityItem {
  id: string;
  kind: IntakeContinuityKind;
  status: ContractIntakeStatus;
  stateLabel: string;
  actionLabel: string;
  href: string;
  /** Contexto de negócio vindo da leitura já persistida — nunca recalculado. */
  contractNumber: string | null;
  title: string | null;
  counterparty: string | null;
  fileName: string;
  attentionCount: number;
  receivedAt: string | null;
  completedAt: string | null;
}

/** URL durável do cadastro em andamento. Atualizar, voltar e avançar continuam funcionando. */
export function onboardingResumeHref(intakeId: string): string {
  return `/contratos/onboarding/${intakeId}`;
}

/**
 * Valor já identificado pela leitura, para um campo do resultado estruturado.
 *
 * Só devolve o que foi classificado como `identified`: um campo em atenção
 * (ambíguo, baixa evidência) NÃO é contexto de negócio confiável e não pode
 * ser exibido na lista como se fosse a contraparte do contrato. Ausência é
 * devolvida como `null` — a lista mostra o nome do arquivo, que é um fato.
 */
function identifiedValue(result: ContractOnboardingResult | null | undefined, key: string): string | null {
  const field = result?.fields?.find((item) => item.key === key);
  if (!field || field.state !== 'identified' || field.value === null) return null;
  const text = String(field.value).trim();
  return text === '' ? null : text;
}

export interface IntakeContinuityRow extends IntakeContinuityInput {
  id: string;
  file_name: string;
  attention_count?: number | null;
  received_at?: string | null;
  completed_at?: string | null;
  structured_result?: ContractOnboardingResult | null;
}

/** Projeta uma linha persistida no item que a carteira exibe. Leitura pura. */
export function summarizeIntakeContinuity(row: IntakeContinuityRow): ContractIntakeContinuityItem {
  const kind = intakeContinuityKind(row);
  const status = row.status as ContractIntakeStatus;
  return {
    id: row.id,
    kind,
    status,
    stateLabel: STATE_LABELS[status] ?? 'Cadastro em andamento',
    actionLabel: ACTION_LABELS[kind],
    href: onboardingResumeHref(row.id),
    contractNumber: identifiedValue(row.structured_result, 'contract_number'),
    title: identifiedValue(row.structured_result, 'title'),
    counterparty: identifiedValue(row.structured_result, 'counterparty'),
    fileName: row.file_name,
    attentionCount: row.attention_count ?? 0,
    receivedAt: row.received_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

/** Só o que está em andamento, do mais recente para o mais antigo. */
export function selectActiveIntakes(rows: IntakeContinuityRow[]): ContractIntakeContinuityItem[] {
  return rows.filter(isActiveIntake)
    .sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')))
    .map(summarizeIntakeContinuity);
}

/**
 * Campos do formulário a partir do prefill JÁ PERSISTIDO.
 *
 * Esta é a única tradução entre o resultado estruturado e o formulário, usada
 * tanto logo após a leitura quanto na retomada — se fossem duas, um cadastro
 * retomado poderia exibir algo diferente do que a pessoa viu na primeira vez.
 *
 * `riskLevel` fica deliberadamente VAZIO: a classificação de risco é
 * recomendação sujeita a confirmação governada (GOVERNED_CONFIRMATION_REQUIRED)
 * e nunca é aceita por padrão — nem na leitura, nem na retomada.
 */
export function formValuesFromIntakePrefill(
  prefill: Record<string, string | number | null> | null | undefined,
): {
  title: string; contractNumber: string; counterparty: string; type: string; status: string;
  startDate: string; endDate: string; signedDate: string; renewalDate: string;
  totalValue: string; monthlyValue: string; paymentTerms: string; scopeSummary: string; riskLevel: string;
} {
  const values = prefill ?? {};
  const text = (key: string) => String(values[key] ?? '');
  const amount = (key: string) => (values[key] == null ? '' : String(values[key]));
  return {
    title: text('title'),
    contractNumber: text('contractNumber'),
    counterparty: text('counterparty'),
    type: text('type'),
    status: text('status'),
    startDate: text('startDate'),
    endDate: text('endDate'),
    signedDate: text('signedDate'),
    renewalDate: text('renewalDate'),
    totalValue: amount('totalValue'),
    monthlyValue: amount('monthlyValue'),
    paymentTerms: text('paymentTerms'),
    scopeSummary: text('scopeSummary'),
    riskLevel: '',
  };
}

export type ResumedIntakeView = 'processing' | 'summary';

/**
 * A tela que a retomada reconstrói.
 *
 * Um resultado pronto volta direto para a MESMA tela de resultado que a pessoa
 * viu quando a leitura terminou. Um cadastro ainda em leitura volta para o
 * acompanhamento, e um cadastro que falhou volta para o acompanhamento com a
 * falha visível e as duas saídas reais (tentar novamente / continuar
 * manualmente). Em nenhum caso o fluxo recomeça pelo envio do documento.
 */
export function resumedIntakeView(
  intake: { status: ContractIntakeStatus | string; structured_result: ContractOnboardingResult | null },
): ResumedIntakeView {
  return RESUMABLE_INTAKE_STATUSES.includes(intake.status as ContractIntakeStatus) && intake.structured_result
    ? 'summary' : 'processing';
}
