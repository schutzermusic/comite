/**
 * Leitura e escrita do motor de obrigações (Fase 3).
 *
 * As tabelas da Fase 3 não concedem escrita ao navegador: quem grava é este
 * módulo, pelo service role, depois que a rota já decidiu a permissão. A
 * leitura poderia ir direto pelo PostgREST — a RLS a escoparia igual — mas
 * passar por aqui mantém uma montagem só do agregado que o resolvedor consome.
 *
 * Server-only: importar no navegador vazaria a chave de serviço.
 */
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveContractObligationsAsOf, type ResolverInput } from '../resolve';
import type {
  ContractObligationsAsOf, ObligationDefinition, ObligationDependencyState,
  ObligationEvidence, ObligationEvidenceRequirement, ObligationException,
  ObligationInstanceState, Tristate,
} from '../types';

if (typeof window !== 'undefined') {
  throw new Error('contracts/obligations/server/store.ts não pode ser importado no navegador.');
}

let client: SupabaseClient | null = null;

export class ObligationSchemaMissingError extends Error {
  constructor() {
    super('O motor de obrigações não está aplicado neste ambiente. Aplique as migrations 114–116.');
    this.name = 'ObligationSchemaMissingError';
  }
}

function check(error: { code?: string; message?: string } | null, context: string): void {
  if (!error) return;
  if (['42P01', 'PGRST205'].includes(error.code ?? '')) throw new ObligationSchemaMissingError();
  throw new Error(`${context}: ${error.message ?? 'erro desconhecido'}`);
}

export function obligationServiceClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');
  client = createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export interface ObligationActor {
  readonly userId: string;
  readonly organizationId: string;
}

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toDefinition(row: Row, parties: Row[]): ObligationDefinition {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    contractId: String(row.contract_id),
    title: String(row.title),
    requirementText: str(row.requirement_text),
    category: str(row.category),
    responsibleSide: row.responsible_side as ObligationDefinition['responsibleSide'],
    provenance: {
      clauseId: str(row.source_clause_id),
      amendmentId: str(row.source_amendment_id),
      documentId: str(row.source_document_id),
      page: num(row.source_page),
      excerpt: str(row.source_excerpt),
    },
    effectiveFrom: str(row.effective_from),
    effectiveTo: str(row.effective_to),
    predecessorId: str(row.predecessor_id),
    changeEffect: row.change_effect as ObligationDefinition['changeEffect'],
    activationKind: row.activation_kind as ObligationDefinition['activationKind'],
    activationOffsetDays: num(row.activation_offset_days),
    activationFixedDate: str(row.activation_fixed_date),
    activationEventText: str(row.activation_event_text),
    dueKind: row.due_kind as ObligationDefinition['dueKind'],
    dueOffsetDays: num(row.due_offset_days),
    dueFixedDate: str(row.due_fixed_date),
    calendarBasis: row.calendar_basis as ObligationDefinition['calendarBasis'],
    recurrenceKind: row.recurrence_kind as ObligationDefinition['recurrenceKind'],
    recurrenceInterval: num(row.recurrence_interval),
    recurrenceUntil: str(row.recurrence_until),
    // `blocks_billing` NULO permanece NULO: o resolvedor precisa da diferença
    // entre "não bloqueia" e "ninguém apurou".
    blocksBilling: row.blocks_billing === null || row.blocks_billing === undefined
      ? null : Boolean(row.blocks_billing),
    status: row.status as ObligationDefinition['status'],
    parties: parties
      .filter((p) => p.definition_id === row.id)
      .map((p) => ({
        id: String(p.id),
        role: p.role as ObligationDefinition['parties'][number]['role'],
        partyId: str(p.party_id),
        partyText: str(p.party_text),
        partyLegalName: str((p.parties as Row | null)?.legal_name),
      })),
  };
}

/**
 * Estado de uma dependência para uma ocorrência.
 *
 * Só é afirmável quando o par é determinável: mesma chave de ocorrência, ou
 * mapeamento explícito. Fora disso a resposta é `UNKNOWN` — casar "o relatório
 * de setembro" com "o aceite de setembro" por parecer óbvio produziria uma
 * dependência plausível e possivelmente errada.
 */
function dependencyStates(
  dependencies: Row[], instances: Row[], occurrenceKey: string, definitionId: string,
  explicitPairs: Row[], instanceId: string, titles: Map<string, string>,
): ObligationDependencyState[] {
  return dependencies
    .filter((d) => d.dependent_definition_id === definitionId)
    .map((d) => {
      const dependsOn = String(d.depends_on_definition_id);
      const base = {
        dependsOnDefinitionId: dependsOn,
        dependsOnTitle: titles.get(dependsOn) ?? 'Obrigação relacionada',
        mappingMode: d.mapping_mode as ObligationDependencyState['mappingMode'],
      };
      let target: Row | undefined;
      if (d.mapping_mode === 'same_occurrence_key') {
        target = instances.find((i) => i.definition_id === dependsOn && i.occurrence_key === occurrenceKey);
      } else if (d.mapping_mode === 'explicit') {
        const pair = explicitPairs.find((p) => p.dependency_id === d.id && p.dependent_instance_id === instanceId);
        target = pair ? instances.find((i) => i.id === pair.depends_on_instance_id) : undefined;
      }
      const satisfied: Tristate = target === undefined
        ? 'UNKNOWN'
        : target.state === 'SATISFIED' ? 'TRUE'
        : target.state === 'WAIVED' || target.state === 'CANCELLED' ? 'UNKNOWN'
        : 'FALSE';
      return { ...base, satisfied };
    });
}

/**
 * O modelo de leitura canônico da Fase 3.
 *
 * `asOf` é obrigatório e sem valor implícito: "hoje" é uma decisão de quem
 * pergunta, e deixá-la aqui faria a mesma consulta responder diferente conforme
 * o fuso do servidor.
 */
export async function loadContractObligationsAsOf(
  organizationId: string, contractId: string, asOf: string,
): Promise<ContractObligationsAsOf> {
  const db = obligationServiceClient();
  // Todas as tabelas da fase carregam (organization_id, contract_id): o mesmo
  // recorte serve para todas, e é o mesmo que a RLS aplicaria.
  const scoped = (table: string) =>
    db.from(table).select('*').eq('organization_id', organizationId).eq('contract_id', contractId);

  const [definitions, parties, instances, requirements, evidence, exceptions, escalations, impacts, dependencies] =
    await Promise.all([
      scoped('contract_obligation_definitions').order('created_at'),
      db.from('contract_obligation_parties').select('*, parties(legal_name)').eq('organization_id', organizationId),
      scoped('contract_obligation_instances').order('period_start'),
      scoped('contract_obligation_evidence_requirements'),
      scoped('contract_obligation_evidence'),
      scoped('contract_obligation_exceptions'),
      db.from('contract_obligation_escalation_rules').select('*').eq('organization_id', organizationId),
      scoped('contract_obligation_financial_impacts'),
      scoped('contract_obligation_dependencies'),
    ]);

  for (const [result, label] of [[definitions, 'definições'], [parties, 'partes'], [instances, 'ocorrências'],
    [requirements, 'exigências de evidência'], [evidence, 'evidências'], [exceptions, 'dispensas'],
    [escalations, 'escalonamentos'], [impacts, 'impactos financeiros'], [dependencies, 'dependências']] as const) {
    check(result.error, `Falha ao ler ${label}`);
  }

  const definitionRows = (definitions.data ?? []) as Row[];
  const instanceRows = (instances.data ?? []) as Row[];
  const definitionIds = new Set(definitionRows.map((d) => String(d.id)));
  const titles = new Map(definitionRows.map((d) => [String(d.id), String(d.title)]));

  const explicitPairs = definitionRows.length
    ? ((await db.from('contract_obligation_instance_dependencies').select('*')
        .eq('organization_id', organizationId)).data ?? []) as Row[]
    : [];

  const input: ResolverInput = {
    contractId,
    asOf,
    obligations: definitionRows.map((definitionRow) => {
      const id = String(definitionRow.id);
      const definitionRequirements: ObligationEvidenceRequirement[] =
        ((requirements.data ?? []) as Row[]).filter((r) => r.definition_id === id).map((r) => ({
          id: String(r.id),
          requirementText: String(r.requirement_text),
          evidenceType: str(r.evidence_type),
          requiredCount: num(r.required_count),
          mandatory: r.mandatory === null || r.mandatory === undefined ? null : Boolean(r.mandatory),
          requiresFormalAcceptance: Boolean(r.requires_formal_acceptance),
        }));

      return {
        definition: toDefinition(definitionRow, (parties.data ?? []) as Row[]),
        evidenceRequirements: definitionRequirements,
        instances: instanceRows.filter((i) => i.definition_id === id).map((i) => {
          const instanceId = String(i.id);
          return {
            id: instanceId,
            definitionId: id,
            occurrenceKey: String(i.occurrence_key),
            periodStart: str(i.period_start),
            periodEnd: str(i.period_end),
            activationState: i.activation_state as 'not_activated' | 'activated' | 'unknown',
            activatedAt: str(i.activated_at),
            dueDate: str(i.due_date),
            dueConfidence: i.due_confidence as 'known' | 'unknown',
            dueBasis: str(i.due_basis),
            state: i.state as ObligationInstanceState,
            satisfiedAt: str(i.satisfied_at),
            satisfactionBasis: str(i.satisfaction_basis),
            evidence: ((evidence.data ?? []) as Row[]).filter((e) => e.instance_id === instanceId).map((e): ObligationEvidence => ({
              id: String(e.id),
              requirementId: str(e.requirement_id),
              documentId: str(e.document_id),
              referenceText: str(e.reference_text),
              acceptanceState: e.acceptance_state as ObligationEvidence['acceptanceState'],
              providedAt: String(e.provided_at),
            })),
            financialImpacts: ((impacts.data ?? []) as Row[])
              .filter((f) => f.definition_id === id && (f.instance_id === null || f.instance_id === instanceId))
              .map((f) => ({
                id: String(f.id),
                recordKind: f.record_kind as 'rule' | 'occurrence',
                impactType: f.impact_type as 'penalty',
                fixedAmount: num(f.fixed_amount),
                percentage: num(f.percentage),
                currency: str(f.currency),
                basisText: str(f.basis_text),
              })),
            exceptions: ((exceptions.data ?? []) as Row[])
              .filter((x) => x.instance_id === instanceId || (x.scope === 'definition' && x.definition_id === id))
              .map((x): Omit<ObligationException, 'effective'> => ({
                id: String(x.id),
                kind: x.kind as 'waiver' | 'exception',
                reason: String(x.reason),
                scope: x.scope as 'definition' | 'instance',
                effectiveFrom: str(x.effective_from),
                effectiveTo: str(x.effective_to),
                authorityReference: str(x.authority_reference),
                sourceDocumentId: str(x.source_document_id),
                sourceAmendmentId: str(x.source_amendment_id),
                approvalState: x.approval_state as ObligationException['approvalState'],
              })),
            escalations: ((escalations.data ?? []) as Row[]).filter((e) => e.definition_id === id).map((e) => ({
              id: String(e.id),
              triggerKind: e.trigger_kind as 'days_before_due' | 'on_due_date' | 'days_after_due',
              offsetDays: num(e.offset_days),
              severity: e.severity as 'low' | 'medium' | 'high' | 'critical',
              targetRole: str(e.target_role),
              targetSide: e.target_side as ObligationDefinition['responsibleSide'] | null,
            })),
            dependencies: dependencyStates(
              ((dependencies.data ?? []) as Row[]).filter((d) => definitionIds.has(String(d.depends_on_definition_id))),
              instanceRows, String(i.occurrence_key), id, explicitPairs, instanceId, titles),
          };
        }),
      };
    }),
  };

  return resolveContractObligationsAsOf(input);
}

/** A carteira inteira, um contrato de cada vez. Sequencial de propósito: são poucos. */
export async function loadPortfolioObligationsAsOf(
  organizationId: string, contractIds: readonly string[], asOf: string,
): Promise<ContractObligationsAsOf[]> {
  const out: ContractObligationsAsOf[] = [];
  for (const contractId of contractIds) {
    out.push(await loadContractObligationsAsOf(organizationId, contractId, asOf));
  }
  return out;
}

// ═══════════════════════════════ ESCRITA ═══════════════════════════════

export interface CreateDefinitionInput {
  contractId: string;
  title: string;
  requirementText?: string;
  category?: string;
  responsibleSide?: ObligationDefinition['responsibleSide'];
  sourceClauseId?: string;
  sourceAmendmentId?: string;
  sourceDocumentId?: string;
  sourcePage?: number;
  sourceExcerpt?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  predecessorId?: string;
  changeEffect?: 'added' | 'altered' | 'removed';
  activationKind?: ObligationDefinition['activationKind'];
  activationOffsetDays?: number;
  activationFixedDate?: string;
  activationEventText?: string;
  dueKind?: ObligationDefinition['dueKind'];
  dueOffsetDays?: number;
  dueFixedDate?: string;
  calendarBasis?: ObligationDefinition['calendarBasis'];
  recurrenceKind?: ObligationDefinition['recurrenceKind'];
  recurrenceInterval?: number;
  recurrenceUntil?: string;
  blocksBilling?: boolean | null;
  parties?: readonly { role: ObligationDefinition['parties'][number]['role']; partyId?: string; partyText?: string }[];
}

export async function createObligationDefinition(actor: ObligationActor, input: CreateDefinitionInput) {
  const db = obligationServiceClient();
  const { data, error } = await db.from('contract_obligation_definitions').insert({
    organization_id: actor.organizationId,
    contract_id: input.contractId,
    title: input.title,
    requirement_text: input.requirementText ?? null,
    category: input.category ?? null,
    responsible_side: input.responsibleSide ?? 'unknown',
    source_clause_id: input.sourceClauseId ?? null,
    source_amendment_id: input.sourceAmendmentId ?? null,
    source_document_id: input.sourceDocumentId ?? null,
    source_page: input.sourcePage ?? null,
    source_excerpt: input.sourceExcerpt ?? null,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    predecessor_id: input.predecessorId ?? null,
    change_effect: input.changeEffect ?? null,
    activation_kind: input.activationKind ?? 'unspecified',
    activation_offset_days: input.activationOffsetDays ?? null,
    activation_fixed_date: input.activationFixedDate ?? null,
    activation_event_text: input.activationEventText ?? null,
    due_kind: input.dueKind ?? 'unspecified',
    due_offset_days: input.dueOffsetDays ?? null,
    due_fixed_date: input.dueFixedDate ?? null,
    calendar_basis: input.calendarBasis ?? 'unspecified',
    recurrence_kind: input.recurrenceKind ?? 'one_time',
    recurrence_interval: input.recurrenceInterval ?? null,
    recurrence_until: input.recurrenceUntil ?? null,
    // `undefined` vira NULL, e NULL é DESCONHECIDO. Só um `false` explícito
    // afirma que a obrigação não bloqueia faturamento.
    blocks_billing: input.blocksBilling ?? null,
    created_by: actor.userId,
  }).select('*').single();
  check(error, 'Falha ao registrar definição de obrigação');

  if (input.parties?.length) {
    const result = await db.from('contract_obligation_parties').insert(input.parties.map((p) => ({
      organization_id: actor.organizationId,
      definition_id: data!.id,
      role: p.role,
      // Sem Party PROVADA o vínculo fica ausente e o texto é preservado.
      party_id: p.partyId ?? null,
      party_text: p.partyText ?? null,
      created_by: actor.userId,
    })));
    check(result.error, 'Falha ao registrar partes da obrigação');
  }
  return data;
}

/** Materializa ocorrências até o horizonte. Repetir não duplica. */
export async function materializeObligation(
  actor: ObligationActor, definitionId: string, through: string,
): Promise<number> {
  const { data, error } = await obligationServiceClient().rpc('contract_obligations_materialize', {
    p_definition_id: definitionId, p_through: through, p_organization_id: actor.organizationId,
  });
  check(error, 'Falha ao materializar ocorrências');
  return Number(data ?? 0);
}

/**
 * Transição de estado de uma ocorrência.
 *
 * O histórico é gravado pelo gatilho, na mesma transação — não há caminho em
 * que o estado mude e o histórico não registre.
 */
export async function transitionObligationInstance(
  actor: ObligationActor,
  instanceId: string,
  next: 'OPEN' | 'SATISFIED' | 'WAIVED' | 'CANCELLED' | 'EXCEPTION',
  options: { satisfactionBasis?: 'explicit_completion' | 'required_evidence_present' | 'contractual_fact'; note?: string } = {},
) {
  const patch: Row = { state: next, satisfaction_note: options.note ?? null };
  if (next === 'SATISFIED') {
    // Cumprimento exige base e autor. Sem os dois, o CHECK do banco recusa — e
    // é isso que impede "cumprida" virar sinônimo de "o prazo passou".
    patch.satisfied_at = new Date().toISOString();
    patch.satisfied_by = actor.userId;
    patch.satisfaction_basis = options.satisfactionBasis ?? 'explicit_completion';
  }
  const { data, error } = await obligationServiceClient()
    .from('contract_obligation_instances').update(patch)
    .eq('organization_id', actor.organizationId).eq('id', instanceId)
    .select('*').maybeSingle();
  check(error, 'Falha ao registrar transição da obrigação');
  if (!data) throw new Error('Ocorrência não encontrada ou em estado incompatível.');
  return data;
}

export async function recordObligationEvidence(
  actor: ObligationActor,
  input: { contractId: string; instanceId: string; requirementId?: string; documentId?: string; referenceText?: string; note?: string },
) {
  const { data, error } = await obligationServiceClient().from('contract_obligation_evidence').insert({
    organization_id: actor.organizationId,
    contract_id: input.contractId,
    instance_id: input.instanceId,
    requirement_id: input.requirementId ?? null,
    document_id: input.documentId ?? null,
    reference_text: input.referenceText ?? null,
    note: input.note ?? null,
    provided_by: actor.userId,
  }).select('*').single();
  check(error, 'Falha ao registrar evidência');
  return data;
}

export async function recordObligationException(
  actor: ObligationActor,
  input: {
    contractId: string; definitionId?: string; instanceId?: string;
    kind: 'waiver' | 'exception'; reason: string; scope: 'definition' | 'instance';
    effectiveFrom?: string; effectiveTo?: string; authorityReference?: string;
    sourceDocumentId?: string; sourceAmendmentId?: string;
    approvalState?: 'not_required' | 'pending';
  },
) {
  const { data, error } = await obligationServiceClient().from('contract_obligation_exceptions').insert({
    organization_id: actor.organizationId,
    contract_id: input.contractId,
    definition_id: input.definitionId ?? null,
    instance_id: input.instanceId ?? null,
    kind: input.kind,
    reason: input.reason,
    scope: input.scope,
    effective_from: input.effectiveFrom ?? null,
    effective_to: input.effectiveTo ?? null,
    authority_reference: input.authorityReference ?? null,
    source_document_id: input.sourceDocumentId ?? null,
    source_amendment_id: input.sourceAmendmentId ?? null,
    approval_state: input.approvalState ?? 'not_required',
    recorded_by: actor.userId,
  }).select('*').single();
  check(error, 'Falha ao registrar dispensa/exceção');
  return data;
}
