/**
 * Prova de ponta a ponta do caminho de HOMOLOGAÇÃO da NFS-e.
 *
 *   npx tsx scripts/smoke-fiscal-homologation.ts
 *
 * Roda o ciclo real — as mesmas funções que as rotas chamam, contra o banco de
 * verdade — numa organização descartável criada e apagada aqui dentro:
 *
 *   estabelecimento → contraparte canônica → perfil fiscal → catálogo →
 *   rascunho → aprovação → transmissão (sandbox) → autorização →
 *   XML arquivado → eventos → tentativas → cancelamento
 *
 * Por que uma organização descartável, e não a real: o caminho passa por RLS,
 * chaves compostas e triggers que só se provam com dado gravado. Fazer isso na
 * organização de produção deixaria NFS-e de teste no portfólio — e nota fiscal
 * inventada é exatamente o que este módulo não pode produzir. A limpeza é um
 * único DELETE na organização, o que também prova que o apagamento privilegiado
 * alcança toda a subárvore fiscal.
 *
 * O provedor é o sandbox: determinístico, e recusa produção por construção. O
 * adaptador REAL não é exercitado aqui porque exige certificado A1 e adesão ao
 * ambiente nacional — ver o portão de credencial no relatório da fase.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

import {
  createFiscalDocument, getFiscalDocument, transitionFiscalDocument,
  enqueueFiscalJob, upsertFiscalPartyProfile, createEstablishment, createService,
  getFiscalServiceClient, FISCAL_DOCUMENT_BUCKET, listFiscalMasterData,
} from '../src/lib/fiscal/server/store';
import { processFiscalJob } from '../src/lib/fiscal/server/engine';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  console.log(`   ${condition ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
};

const suffix = Math.random().toString(36).slice(2, 10);
let organizationId = '';

const pgClient = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await pgClient.connect();

  // ---------- cenário descartável ----------
  const org = await admin.from('organizations')
    .insert({ name: `Fiscal Smoke ${suffix}`, slug: `fiscal-smoke-${suffix}` }).select('id').single();
  if (org.error) throw new Error(`Falha ao criar organização de prova: ${org.error.message}`);
  organizationId = String(org.data.id);
  const actor = { organizationId, userId: null as unknown as string };
  console.log(`\n=== ORGANIZAÇÃO DESCARTÁVEL ${organizationId} ===`);

  console.log('\n=== 1. CADASTROS ===');
  const establishment = await createEstablishment(actor, {
    legalName: 'Insight Smoke Emitente', cnpj: '11222333000181', municipalRegistration: 'IM-SMOKE',
    taxRegime: 'lucro_presumido', municipalityIbge: '3550308', municipalityName: 'São Paulo', uf: 'SP',
    postalCode: '01001000', street: 'Praça da Sé', streetNumber: '100', district: 'Sé',
    environment: 'homologation', nfseSeries: '1',
  }) as { id: string; environment: string; production_enabled: boolean; next_dps_number: number };
  check('estabelecimento nasce em homologação', establishment.environment === 'homologation');
  check('estabelecimento nasce SEM produção habilitada', establishment.production_enabled === false);

  const party = await admin.from('parties').insert({
    organization_id: organizationId, kind: 'organization', legal_name: 'Cliente Smoke S.A.',
    document_type: 'cnpj', document_number: '44555666000177',
  }).select('id,document_normalized').single();
  if (party.error) throw new Error(`Falha ao criar Party canônica: ${party.error.message}`);
  check('contraparte é Party canônica', Boolean(party.data.document_normalized), `documento ${party.data.document_normalized}`);

  const profile = await upsertFiscalPartyProfile(actor, {
    partyId: party.data.id, municipalRegistration: 'IM-CLIENTE', email: 'fiscal@cliente.example',
    municipalityIbge: '3304557', municipalityName: 'Rio de Janeiro', uf: 'RJ',
    postalCode: '20010000', street: 'Av. Rio Branco', streetNumber: '1', district: 'Centro',
  }) as { id: string };
  check('perfil fiscal criado como EXTENSÃO da Party', Boolean(profile.id));

  const service = await createService(actor, {
    establishmentId: establishment.id, code: 'SMOKE-1', description: 'Serviço de engenharia',
    lc116Code: '7.02', municipalServiceCode: '070200', issRate: 2, pisRate: 0.65, cofinsRate: 3,
    inssRate: 0, irRate: 1.5, csllRate: 1, ibsRate: 0, cbsRate: 0, issWithheldDefault: false,
    effectiveFrom: '2026-01-01', version: 1, approvedByAccountant: true,
  }) as { id: string };

  const master = await listFiscalMasterData(organizationId);
  check('cadastro mestre expõe a contraparte canônica com perfil', master.recipients.length === 1 && master.recipients[0].profile !== null);
  check('cadastro mestre não devolve coluna cifrada',
    !JSON.stringify(master.providerConfigs).includes('_cipher'));

  // ---------- integração ----------
  console.log('\n=== 2. INTEGRAÇÃO (sandbox, homologação) ===');
  const config = await admin.from('fiscal_provider_configs').insert({
    organization_id: organizationId, establishment_id: establishment.id,
    provider_key: 'sandbox', environment: 'homologation', enabled: true,
  }).select('id').single();
  check('integração sandbox habilitada em homologação', !config.error, config.error?.message ?? '');

  const sandboxInProd = await admin.from('fiscal_provider_configs').insert({
    organization_id: organizationId, establishment_id: establishment.id,
    provider_key: 'sandbox', environment: 'production', enabled: true,
  });
  check('sandbox em PRODUÇÃO é recusado pelo banco', Boolean(sandboxInProd.error));

  const forceProduction = await pgClient.query(
    `UPDATE fiscal_establishments SET production_enabled = true WHERE id = $1`, [establishment.id],
  ).then(() => null).catch((e: Error) => e);
  check('habilitar produção sem portão é recusado', forceProduction !== null,
    forceProduction ? (forceProduction as Error).message.slice(0, 60) : 'PASSOU — falha grave');

  // ---------- ciclo do documento ----------
  console.log('\n=== 3. RASCUNHO ===');
  const draft = await createFiscalDocument(actor, {
    establishmentId: establishment.id, partyId: party.data.id, serviceCatalogId: service.id,
    competenceDate: '2026-08-01', serviceLocationIbge: '3550308',
    description: 'Serviço de engenharia & manutenção mensal', amountCents: 1_000_000,
    quantity: 1, deductionsCents: 0, unconditionalDiscountCents: 0, conditionalDiscountCents: 0,
    idempotencyKey: `smoke-${suffix}`,
  });
  check('rascunho criado', draft.status === 'draft');
  check('ambiente do documento congelado em homologação', draft.environment === 'homologation');
  check('tomador é a Party canônica', draft.party_id === party.data.id);
  check('perfil fiscal vinculado', draft.party_profile_id === profile.id);
  check('nada foi contabilizado no Financeiro', draft.finance_status === 'not_posted');
  check('tributos calculados', draft.withheld_total_cents > 0 || draft.issuer_tax_total_cents > 0,
    `retido ${draft.withheld_total_cents}, emitente ${draft.issuer_tax_total_cents}`);

  const repeat = await createFiscalDocument(actor, {
    establishmentId: establishment.id, partyId: party.data.id, serviceCatalogId: service.id,
    competenceDate: '2026-08-01', serviceLocationIbge: '3550308',
    description: 'Serviço de engenharia & manutenção mensal', amountCents: 1_000_000,
    quantity: 1, deductionsCents: 0, unconditionalDiscountCents: 0, conditionalDiscountCents: 0,
    idempotencyKey: `smoke-${suffix}`,
  });
  check('idempotência devolve o MESMO rascunho', repeat.id === draft.id);

  console.log('\n=== 4. APROVAÇÃO E TRANSMISSÃO ===');
  await transitionFiscalDocument(actor, draft.id, 'draft', 'pending_approval', 'submitted', 'Enviado para aprovação.');
  await transitionFiscalDocument(actor, draft.id, 'pending_approval', 'approved', 'approved', 'Aprovado.');
  await transitionFiscalDocument(actor, draft.id, 'approved', 'queued', 'queued', 'Na fila.');

  const jobId = await enqueueFiscalJob(actor, draft.id, 'issue', `issue:${draft.id}:${suffix}`);
  const repeatJob = await enqueueFiscalJob(actor, draft.id, 'issue', `issue:${draft.id}:${suffix}`);
  check('tarefa é idempotente', jobId === repeatJob);

  const processing = await processFiscalJob(jobId);
  check('transmissão processada', processing.processed && !processing.error, processing.error ?? '');

  const issued = await getFiscalDocument(organizationId, draft.id);
  check('NFS-e AUTORIZADA em homologação', issued?.document.status === 'authorized', issued?.document.status ?? 'sem documento');
  check('chave de acesso recebida do provedor', Boolean(issued?.document.access_key));
  check('número da nota recebido', Boolean(issued?.document.document_number));
  check('número de DPS reservado e gravado', Boolean(issued?.document.dps_number));
  check('data de emissão registrada', Boolean(issued?.document.issue_date));
  check('provedor registrado no documento', issued?.document.provider_key === 'sandbox');
  check('Financeiro continua intocado', issued?.document.finance_status === 'not_posted');

  console.log('\n=== 5. ARTEFATOS ===');
  check('caminho do XML gravado', Boolean(issued?.document.xml_storage_path));
  check('hash do XML gravado', Boolean(issued?.document.xml_sha256));
  const xml = await getFiscalServiceClient().storage.from(FISCAL_DOCUMENT_BUCKET)
    .download(issued!.document.xml_storage_path!);
  const xmlText = xml.data ? await xml.data.text() : '';
  check('XML recuperável do bucket privado', xmlText.length > 0);
  check('XML é do padrão nacional', xmlText.includes('sped.fazenda.gov.br/nfse'));
  check('XML fica sob o prefixo da organização',
    issued!.document.xml_storage_path!.startsWith(`${organizationId}/`));
  const bucket = await pgClient.query(`SELECT public FROM storage.buckets WHERE id = 'fiscal-documents'`);
  check('bucket é privado', bucket.rows[0].public === false);

  console.log('\n=== 6. AUDITORIA ===');
  check('eventos registrados', (issued?.events.length ?? 0) >= 3, `${issued?.events.length} eventos`);
  check('a autorização virou evento', issued!.events.some((e) => e.event_type === 'provider_authorized'));
  const attempts = await pgClient.query(
    `SELECT operation, attempt_number, status, environment FROM fiscal_transmission_attempts WHERE document_id = $1`, [draft.id]);
  check('tentativa de transmissão registrada', attempts.rows.length === 1, JSON.stringify(attempts.rows[0] ?? {}));
  check('tentativa registra o ambiente', attempts.rows[0]?.environment === 'homologation');

  console.log('\n=== 7. IMUTABILIDADE ===');
  const rewrite = await pgClient.query(
    `UPDATE fiscal_documents SET service_amount_cents = 1 WHERE id = $1`, [draft.id],
  ).then(() => null).catch((e: Error) => e);
  check('valor da NFS-e autorizada não pode ser reescrito', rewrite !== null);
  const rewriteEvent = await pgClient.query(
    `UPDATE fiscal_events SET message = 'x' WHERE document_id = $1`, [draft.id],
  ).then(() => null).catch((e: Error) => e);
  check('evento fiscal não pode ser reescrito', rewriteEvent !== null);

  // ---------- portão de credencial do provedor REAL ----------
  // Prova que trocar o sandbox pelo adaptador real PARA e diz o que falta, em
  // vez de tentar, falhar seis vezes e deixar o documento num estado que
  // ninguém consegue explicar. É o comportamento correto: nenhuma retentativa
  // resolve a ausência de um certificado.
  console.log('\n=== 7b. PROVEDOR REAL — PORTÃO DE CREDENCIAL ===');
  await admin.from('fiscal_provider_configs').update({ enabled: false })
    .eq('organization_id', organizationId).eq('provider_key', 'sandbox');
  const realConfig = await admin.from('fiscal_provider_configs').insert({
    organization_id: organizationId, establishment_id: establishment.id,
    provider_key: 'nfse_nacional', environment: 'homologation', enabled: true,
  }).select('id').single();
  check('integração com o provedor REAL aceita em homologação', !realConfig.error, realConfig.error?.message ?? '');

  const gateDraft = await createFiscalDocument(actor, {
    establishmentId: establishment.id, partyId: party.data.id, serviceCatalogId: service.id,
    competenceDate: '2026-08-01', serviceLocationIbge: '3550308',
    description: 'Prova do portão de credencial do provedor real', amountCents: 500_000,
    quantity: 1, deductionsCents: 0, unconditionalDiscountCents: 0, conditionalDiscountCents: 0,
    idempotencyKey: `smoke-gate-${suffix}`,
  });
  await transitionFiscalDocument(actor, gateDraft.id, 'draft', 'pending_approval', 'submitted', 'Enviado.');
  await transitionFiscalDocument(actor, gateDraft.id, 'pending_approval', 'approved', 'approved', 'Aprovado.');
  await transitionFiscalDocument(actor, gateDraft.id, 'approved', 'queued', 'queued', 'Na fila.');
  const gateJob = await enqueueFiscalJob(actor, gateDraft.id, 'issue', `issue:${gateDraft.id}:${suffix}`);
  const gateResult = await processFiscalJob(gateJob);
  check('transmissão real PARA no portão de credencial', Boolean(gateResult.error));
  check('o erro NOMEIA o que falta',
    /faltam pré-requisitos externos/.test(gateResult.error ?? ''), (gateResult.error ?? '').slice(0, 160));
  const gateJobRow = await pgClient.query('SELECT status, attempts FROM fiscal_jobs WHERE id = $1', [gateJob]);
  check('a tarefa não fica retentando o que retentar não resolve',
    gateJobRow.rows[0].status === 'dead_letter', `status ${gateJobRow.rows[0].status}, ${gateJobRow.rows[0].attempts} tentativa(s)`);
  const gateDoc = await getFiscalDocument(organizationId, gateDraft.id);
  check('nenhuma NFS-e foi inventada no lugar da que não pôde ser emitida',
    gateDoc?.document.status !== 'authorized' && !gateDoc?.document.access_key, gateDoc?.document.status ?? '');
  check('o bloqueio virou evento auditável',
    gateDoc!.events.some((e) => e.event_type === 'transmission_blocked'));

  await admin.from('fiscal_provider_configs').update({ enabled: false })
    .eq('organization_id', organizationId).eq('provider_key', 'nfse_nacional');
  await admin.from('fiscal_provider_configs').update({ enabled: true })
    .eq('organization_id', organizationId).eq('provider_key', 'sandbox');

  console.log('\n=== 8. CANCELAMENTO ===');
  await transitionFiscalDocument(actor, draft.id, 'authorized', 'cancellation_requested',
    'cancellation_requested', 'Cancelamento solicitado.', { cancellation_reason: 'Prova de homologação do fluxo' });
  const cancelJob = await enqueueFiscalJob(actor, draft.id, 'cancel', `cancel:${draft.id}:${suffix}`,
    { reason: 'Prova de homologação do fluxo' });
  const cancelResult = await processFiscalJob(cancelJob);
  check('cancelamento processado', cancelResult.processed && !cancelResult.error, cancelResult.error ?? '');
  const cancelled = await getFiscalDocument(organizationId, draft.id);
  check('NFS-e CANCELADA', cancelled?.document.status === 'cancelled', cancelled?.document.status ?? '');
  check('data de cancelamento registrada', Boolean(cancelled?.document.cancelled_at));
  check('motivo do cancelamento preservado', Boolean(cancelled?.document.cancellation_reason));
}

async function cleanup() {
  if (!organizationId) return;
  console.log('\n=== LIMPEZA ===');
  const paths = (await pgClient.query(
    `SELECT name FROM storage.objects WHERE bucket_id = 'fiscal-documents' AND name LIKE $1`,
    [`${organizationId}/%`])).rows.map((r) => r.name);
  if (paths.length) {
    await getFiscalServiceClient().storage.from(FISCAL_DOCUMENT_BUCKET).remove(paths);
  }
  await pgClient.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
  const left = await pgClient.query(
    `SELECT (SELECT count(*) FROM fiscal_documents WHERE organization_id = $1)
          + (SELECT count(*) FROM fiscal_establishments WHERE organization_id = $1)
          + (SELECT count(*) FROM fiscal_events WHERE organization_id = $1)
          + (SELECT count(*) FROM parties WHERE organization_id = $1) n`, [organizationId]);
  check('apagar a organização alcançou toda a subárvore fiscal', left.rows[0].n === '0', `${left.rows[0].n} linha(s)`);
  const objects = await pgClient.query(
    `SELECT count(*) n FROM storage.objects WHERE bucket_id = 'fiscal-documents' AND name LIKE $1`, [`${organizationId}/%`]);
  check('nenhum artefato de prova ficou no bucket', objects.rows[0].n === '0');
}

async function run() {
  try {
    await main();
  } catch (error) {
    failures += 1;
    console.error(`\n!!! FALHA: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await cleanup().catch((e: Error) => console.error(`!!! limpeza incompleta: ${e.message}`));
    await pgClient.end();
  }
  console.log(`\n${failures === 0 ? '>>> HOMOLOGAÇÃO (SANDBOX): TODAS AS PROVAS PASSARAM' : `>>> ${failures} PROVA(S) FALHARAM`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void run();
