/**
 * Verificação funcional de Pessoas & Custos / eSocial contra o banco real.
 *
 * Exercita os MESMOS caminhos de leitura que as rotas usam, em vez de apenas
 * conferir se as tabelas existem. É o que distingue "a migration rodou" de "a
 * seção funciona": uma tabela criada com RLS errada, uma função sem GRANT ou
 * um cache de schema não recarregado passam no primeiro teste e falham no
 * segundo.
 *
 * Roda depois de `node scripts/apply-esocial-migration.mjs` e da reapuração.
 *
 * Uso: npx tsx scripts/verify-workforce-pipeline.ts <organization_id>
 */
import { readFileSync } from 'node:fs';
import type { SalaryHistoryLine } from '@/lib/workforce/salary-history';

for (const file of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    // Ambiente já carregado por fora.
  }
}

const ORG = process.argv[2];
if (!ORG) {
  console.error('Informe a organização: npx tsx scripts/verify-workforce-pipeline.ts <organization_id>');
  process.exit(1);
}

const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const info = (s: string) => console.log(`    ${s}`);
const gap = (s: string) => console.log(`  \x1b[33m·\x1b[0m ${s}`);

async function main() {
  const store = await import('@/lib/esocial/connector/store');
  const asoStore = await import('@/lib/workforce/aso-store');
  const audit = await import('@/lib/workforce/esocial-audit');
  const asoAlerts = await import('@/lib/workforce/aso-alerts');
  const salary = await import('@/lib/workforce/salary-history');
  const { createClient } = await import('@supabase/supabase-js');

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log('\n── 1. SST / ASO & CAT (migration 084) ──');
  const sst = await store.readSstEvents(ORG);
  ok(`readSstEvents responde: ${sst.length} linha(s)`);
  const cat = sst.filter((s) => s.event_type === 'S-2210').length;
  const aso = sst.filter((s) => s.event_type === 'S-2220').length;
  const risco = sst.filter((s) => s.event_type === 'S-2240').length;
  info(`CAT ${cat} · ASO ${aso} · exposição a risco ${risco}`);
  if (sst.length === 0) gap('acervo sem eventos de SST — a seção abre vazia, e é o estado correto');

  console.log('\n── 2. Documentos de ASO (migrations 085 + 089) ──');
  const docs = await asoStore.listAsoDocuments(ORG);
  ok(`listAsoDocuments responde: ${docs.length} documento(s)`);
  const autoApproved = docs.filter((d) => d.review_status === 'approved' && !d.reviewed_by);
  if (autoApproved.length > 0) {
    throw new Error(`${autoApproved.length} documento(s) aprovados sem revisor — auto-aprovação detectada`);
  }
  ok('nenhum documento aprovado sem revisor humano');
  const lostOriginal = docs.filter((d) => !d.object_path);
  if (lostOriginal.length > 0) {
    throw new Error(`${lostOriginal.length} documento(s) sem arquivo original — o PDF precisa ser preservado`);
  }
  ok('todos os documentos apontam para o PDF original preservado');
  const basis = new Set(docs.map((d) => d.validity_basis));
  info(`validity_basis em uso: ${basis.size ? [...basis].join(', ') : '(nenhum documento ainda)'}`);

  console.log('\n── 3. Auditoria eSocial (migration 086) ──');
  const counts = await store.readAuditCounts(ORG);
  if (!counts) throw new Error('readAuditCounts devolveu null — a função 086 não está acessível');
  const totalEvents = counts.byType.reduce((s, t) => s + Number(t.total), 0);
  ok(`countsSource = "sql" · ${totalEvents} eventos agregados no banco`);
  info(`${counts.byType.length} tipos distintos · ${counts.byOrigin.length} origem(ns) de emissão`);
  for (const o of counts.byOrigin) {
    info(`origem procEmi=${o.proc_emi ?? 'não declarado'} verProc=${o.ver_proc ?? '—'} → ${o.total} evento(s)`);
  }

  console.log('\n── 4. Cobertura, S-1299 e S-3000 ──');
  const metrics = await store.readCompetenceMetrics(ORG);
  const control = await store.readEventIndex(ORG, ['S-1299', 'S-3000']);
  const receipts = control
    .filter((e) => e.event_type === 'S-3000')
    .map((e) => (e.metadata?.exclusion as { targetReceipt?: string } | undefined)?.targetReceipt)
    .filter((r): r is string => Boolean(r));
  const existing = await store.findExistingReceipts(ORG, receipts);

  const eventCountByCompetence = new Map<string, number>();
  for (const row of counts.byCompetence) eventCountByCompetence.set(row.competence, Number(row.total));
  const closedCompetences = new Set(
    control.filter((e) => e.event_type === 'S-1299' && e.competence).map((e) => e.competence as string),
  );
  const coverage = audit.buildCompetenceCoverage(metrics, { eventCountByCompetence, closedCompetences });
  ok(`${coverage.rows.length} competência(s) no intervalo · ${coverage.missing.length} faltando no acervo`);
  ok(`${coverage.rows.filter((r) => r.closed).length} com fechamento S-1299`);

  const exclusions = audit.buildExclusions(control, existing);
  const stillPresent = exclusions.filter((e) => e.targetStillPresent).length;
  ok(`${exclusions.length} exclusão(ões) S-3000 REPORTADAS (alvo ainda no acervo: ${stillPresent})`);
  info('exclusões não são subtraídas dos agregados — comportamento preservado de propósito');

  const gaps = audit.buildRubricGaps(metrics);
  ok(`${gaps.length} competência(s) com rubrica por classificar`);

  console.log('\n── 5. Fila de vencimento de ASO ──');
  const employments = await store.readEmployments(ORG, { status: 'active' });
  const s2220 = await store.readSstEvents(ORG, { eventType: 'S-2220' });
  const queue = asoAlerts.buildAsoAlerts({
    workers: employments.map((e) => ({
      workerKey: e.worker_cpf_hash ?? e.matricula,
      name: e.worker_name ?? null,
      areaLabel: e.area_label ?? null,
    })),
    documents: docs.map((d) => ({
      id: d.id,
      workerKey: d.worker_cpf_hash,
      personId: d.person_id,
      examDate: d.exam_date,
      examKind: d.exam_kind,
      validityDate: d.validity_date,
      validityBasis: d.validity_basis,
      documentStatus: d.document_status,
      esocialMatchStatus: d.esocial_match_status,
      esocialEventId: d.esocial_event_id,
      divergenceSummary: d.divergence_summary,
    })),
    esocialExams: s2220.map((r) => ({
      workerKey: r.worker_cpf_hash ?? r.matricula,
      examDate: r.event_date,
      examKind: r.exam_kind,
      validityDate: r.aso_valid_until,
      eventId: r.esocial_event_id,
    })),
  });
  const summary = asoAlerts.summarizeAsoAlerts(queue);
  ok(`fila montada sobre ${summary.total} colaborador(es)`);
  info(`vencidos ${summary.expired} · vencem em 30d ${summary.expiring30} · em 60d ${summary.expiring60}`);
  info(`aguardando revisão ${summary.pendingReview} · rejeitados/a corrigir ${summary.needsCorrection}`);
  info(`sem vencimento apurável ${summary.noValidity} · documento não enviado ${summary.noDocument}`);
  info(`divergentes do S-2220 ${summary.esocialDivergent} — aviso, nunca bloqueio`);
  if (summary.noDocument === summary.total && summary.total > 0) {
    gap('nenhum ASO em PDF no acervo — o controle só começa quando os documentos originais sobem');
  }

  console.log('\n── 6. Série salarial e normalização do 13º ──');
  const { data: batches } = await db
    .from('payroll_closing_batches')
    .select('id, competence_month')
    .eq('organization_id', ORG)
    .in('status', [...salary.APPROVED_BATCH_STATUSES]);
  const batchIds = (batches ?? []).map((b) => b.id as string);
  const { data: lines } = batchIds.length
    ? await db
        .from('payroll_employee_lines')
        .select('batch_id, employee_name, cost_center_label, contract_type, gross_amount_cents, net_amount_cents')
        .in('batch_id', batchIds)
    : { data: [] };
  const { data: people } = await db
    .from('people')
    .select('id, full_name, payroll_name_key')
    .eq('organization_id', ORG);

  const history = salary.buildSalaryHistory({
    batches: (batches ?? []).map((b) => ({
      id: String(b.id),
      competence_month: String(b.competence_month),
    })),
    lines: (lines ?? []) as SalaryHistoryLine[],
    people: (people ?? []).map((p) => ({
      id: String(p.id),
      full_name: String(p.full_name),
      payroll_name_key: p.payroll_name_key ? String(p.payroll_name_key) : null,
    })),
  });
  ok(`${history.competencesObserved.length} competência(s) de folha aprovada · ${(lines ?? []).length} linha(s) por colaborador`);
  ok(`${history.counts.peopleMatched} pessoa(s) na série · ${history.counts.peopleUnmatched} nome(s) sem vínculo`);
  info(`sem reajuste +12m ${history.counts.withoutRaise12m} · reajustados ${history.counts.raisedWithin12m} · não determinado ${history.counts.indeterminate}`);
  for (const n of history.notes) info(`nota: ${n}`);
  if ((lines ?? []).length === 0) {
    gap('sem linhas por colaborador: a normalização do 13º não tem série real para exercitar');
  }

  console.log('\n── 7. Visão Geral / Folha & Encargos ──');
  const areas = await store.readAreaMetrics(ORG);
  const active = await store.countActiveEmployments(ORG);
  ok(`${metrics.length} competência(s) apurada(s) · ${areas.length} recorte(s) por lotação · ${active} vínculo(s) ativo(s)`);

  const { data: ccs } = await db.from('finance_cost_centers').select('id, code, name').eq('organization_id', ORG);
  const { data: aliases } = await db
    .from('payroll_cost_center_mappings')
    .select('normalized_name')
    .eq('organization_id', ORG);
  const unmapped = audit.buildUnmappedLotacoes(
    areas,
    (ccs ?? []).map((c) => ({ id: String(c.id), code: String(c.code ?? ''), name: String(c.name ?? '') })),
    new Set((aliases ?? []).map((a) => String(a.normalized_name ?? '').trim().toLowerCase())),
  );
  ok(`${unmapped.length} lotação(ões) do eSocial sem centro de custo correspondente`);

  console.log('\nVerificação concluída sem erro.\n');
}

main().catch((err) => {
  console.error('\nFALHOU:', err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
