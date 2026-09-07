/**
 * RECEPÇÃO FISCAL DO FATURAMENTO LIBERADO — a ponte, do lado do Fiscal.
 *
 * ─── Por que este arquivo mora em `lib/fiscal`, e não em `lib/contracts` ──
 *
 * Porque é o Fiscal que decide se sai nota, e a §29 da Fase 7 é absoluta:
 * Contratos nunca insere em `fiscal_documents`. O que Contratos faz é
 * declarar um fato — "faturamento liberado" — e abrir um PEDIDO durável. Quem
 * lê o pedido é este módulo, que pertence ao Fiscal, roda no servidor e usa o
 * serviço fiscal que já existe.
 *
 * A diferença não é de pasta: se este código vivesse em Contratos, o dia em
 * que alguém precisasse de um campo fiscal novo acabaria com Contratos
 * montando `issuer_snapshot` — e aí existiriam duas verdades fiscais.
 *
 * ─── O que ele NÃO faz ───────────────────────────────────────────────────
 *
 * Não transmite. Não autoriza. Não liga produção. Cria RASCUNHO, e o rascunho
 * segue o ciclo normal do Fiscal: aprovação, `fiscal.transmit`, fila
 * `fiscal_jobs`, portão de produção. A §30 é explícita — faturamento liberado
 * não é permissão para emitir NFS-e real.
 *
 * ─── Configuração ausente é resposta, não erro ───────────────────────────
 *
 * Sem estabelecimento ativo, sem catálogo de serviço ou sem perfil fiscal da
 * contraparte, o pedido termina em `BLOCKED_BY_CONFIGURATION` com os bloqueios
 * NOMEADOS. Fingir um catálogo para o rascunho nascer seria inventar
 * tributação alheia.
 */
import { getFiscalServiceClient, createFiscalDocument } from './store';
import type { FiscalActor } from './actor';

export interface BillingIntakeInput {
  readonly organizationId: string;
  readonly requestId: string;
  readonly billingEventId: string;
}

export interface BillingIntakeOutcome {
  readonly request_id: string;
  readonly state: 'DRAFT_CREATED' | 'BLOCKED_BY_CONFIGURATION';
  readonly fiscal_document_id?: string;
  readonly blockers?: ReadonlyArray<{ code: string; detail?: string }>;
}

/** Bloqueio nomeado. Um booleano obrigaria quem opera a adivinhar o motivo. */
type Blocker = { code: string; detail?: string };

export async function requestFiscalDraftForBilling(
  input: BillingIntakeInput,
): Promise<BillingIntakeOutcome> {
  const client = getFiscalServiceClient();
  const blockers: Blocker[] = [];

  const readiness = await client.rpc('contract_billing_fiscal_readiness', {
    p_billing_event_id: input.billingEventId,
  });
  if (readiness.error) throw new Error(`Prontidão fiscal indisponível: ${readiness.error.message}`);
  const ready = (readiness.data ?? {}) as {
    ready?: boolean; blockers?: Blocker[]; establishment_id?: string | null;
    amount_cents?: number | null; party_id?: string | null; contract_id?: string | null;
    currency?: string | null;
  };
  if (!ready.ready) {
    return finishBlocked(client, input, ready.blockers ?? [{ code: 'FISCAL_NOT_READY' }]);
  }

  const establishmentId = ready.establishment_id ?? null;
  const partyId = ready.party_id ?? null;
  const amountCents = ready.amount_cents ?? 0;
  if (!establishmentId) blockers.push({ code: 'FISCAL_ESTABLISHMENT_MISSING' });
  if (!partyId) blockers.push({ code: 'COUNTERPARTY_UNRESOLVED' });
  if (!(amountCents > 0)) blockers.push({ code: 'AMOUNT_UNKNOWN' });
  /*
    A prontidão da RPC já cobre estes três; a repetição aqui não é zelo
    decorativo, é o que dá ao compilador a garantia de que eles existem no
    resto da função — e o que impede que uma mudança futura na RPC deixe um
    nulo chegar ao serviço fiscal por caminho silencioso.
  */
  /*
    Moeda: o serviço fiscal só emite NFS-e em BRL, e o esquema fiscal é todo em
    centavos de real. Um faturamento em outra moeda não é bloqueado por
    limitação técnica — ele exigiria política de câmbio, que a §78 proíbe
    inventar.
  */
  if (ready.currency && ready.currency !== 'BRL') {
    blockers.push({ code: 'CURRENCY_NOT_SUPPORTED_BY_FISCAL', detail: ready.currency });
  }
  if (blockers.length || !establishmentId || !partyId) {
    return finishBlocked(client, input, blockers);
  }

  /*
    O catálogo de serviço é ESCOLHA FISCAL, e não há regra que ligue contrato a
    item de catálogo neste repositório. Quando o estabelecimento tem
    exatamente um serviço ativo, a escolha é determinística e é feita. Com
    vários, escolher seria arbitrar a tributação do faturamento — o pedido
    espera decisão humana, com o motivo nomeado.
  */
  const services = await client
    .from('fiscal_service_catalog')
    .select('id, description, municipal_service_code')
    .eq('organization_id', input.organizationId)
    .eq('establishment_id', establishmentId)
    .eq('active', true);
  if (services.error) throw new Error(`Catálogo fiscal indisponível: ${services.error.message}`);
  const catalog = services.data ?? [];
  if (catalog.length === 0) {
    return finishBlocked(client, input, [{ code: 'FISCAL_SERVICE_CATALOG_MISSING' }]);
  }
  if (catalog.length > 1) {
    return finishBlocked(client, input, [{
      code: 'FISCAL_SERVICE_SELECTION_REQUIRED',
      detail: `${catalog.length} serviços ativos: a escolha define a tributação e é do Fiscal.`,
    }]);
  }

  const establishment = await client
    .from('fiscal_establishments')
    .select('id, municipality_ibge')
    .eq('organization_id', input.organizationId)
    .eq('id', establishmentId)
    .maybeSingle<{ id: string; municipality_ibge: string }>();
  if (establishment.error) throw new Error(`Estabelecimento indisponível: ${establishment.error.message}`);
  if (!establishment.data?.municipality_ibge) {
    return finishBlocked(client, input, [{ code: 'FISCAL_SERVICE_LOCATION_MISSING' }]);
  }

  const billing = await client
    .from('contract_billing_events')
    .select('id, title, due_date, release_fingerprint, contract_id')
    .eq('organization_id', input.organizationId)
    .eq('id', input.billingEventId)
    .maybeSingle<{
      id: string; title: string; due_date: string | null;
      release_fingerprint: string | null; contract_id: string;
    }>();
  if (billing.error) throw new Error(`Faturamento indisponível: ${billing.error.message}`);
  if (!billing.data) throw new Error('Faturamento inexistente para o pedido fiscal.');

  /*
    O ator do rascunho é o SISTEMA, e ele se identifica como tal: `userId` nulo.
    A §70 proíbe que um caminho automático assine com o nome de uma pessoa —
    quem lê o rascunho depois precisa saber que ninguém o digitou.
  */
  const actor: FiscalActor = { userId: null, organizationId: input.organizationId };

  const draft = await createFiscalDocument(actor, {
    establishmentId,
    partyId,
    serviceCatalogId: String(catalog[0].id),
    competenceDate: new Date().toISOString().slice(0, 10),
    dueDate: billing.data.due_date ?? undefined,
    serviceLocationIbge: establishment.data.municipality_ibge,
    description: billing.data.title,
    amountCents,
    contractId: billing.data.contract_id,
    // A chave de idempotência é a IMPRESSÃO DA LIBERAÇÃO, e não um UUID novo:
    // retentar o mesmo pedido devolve o mesmo rascunho (§109).
    idempotencyKey: `billing-release:${billing.data.id}:${billing.data.release_fingerprint ?? 'nofp'}`,
  });

  const link = await client.rpc('contract_billing_link_fiscal_document', {
    p_billing_event_id: input.billingEventId,
    p_fiscal_document_id: draft.id,
    p_request_id: input.requestId,
  });
  if (link.error) throw new Error(`Vínculo faturamento↔nota falhou: ${link.error.message}`);

  return { request_id: input.requestId, state: 'DRAFT_CREATED', fiscal_document_id: draft.id };
}

async function finishBlocked(
  client: ReturnType<typeof getFiscalServiceClient>,
  input: BillingIntakeInput,
  blockers: readonly Blocker[],
): Promise<BillingIntakeOutcome> {
  const update = await client
    .from('contract_billing_fiscal_requests')
    .update({
      state: 'BLOCKED_BY_CONFIGURATION',
      blockers,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.requestId)
    .eq('organization_id', input.organizationId);
  if (update.error) throw new Error(`Falha ao registrar bloqueio fiscal: ${update.error.message}`);
  return { request_id: input.requestId, state: 'BLOCKED_BY_CONFIGURATION', blockers };
}
