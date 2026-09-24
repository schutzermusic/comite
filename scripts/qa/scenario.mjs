/**
 * Cenário operacional REALISTA no QA isolado — para a validação visual e a
 * prova de ponta a ponta verem telas com a forma de uma operação de verdade,
 * e não um inquilino vazio (ou cheio de fixture de teste).
 *
 *   node scripts/qa/scenario.mjs            # idempotente (marca: projeto qa-scn-tucurui)
 *
 * Tudo pelas funções GOVERNADAS, com o papel certo como ator: pacote aceito →
 * OS gerada, revisada e emitida → projeto a partir da OS → requisitos →
 * reserva, transferência, requisição, cotação, pedido, recebimento parcial,
 * quarentena. Só o cronograma e o risco nascem por INSERT: são domínios de
 * Projetos/Riscos sem função governada nesta fronteira.
 */
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { withQaDb, kit } from './lib/qa-db.mjs';
import { QA_LIVE_FILE, assertLocal, loadQaEnv } from './lib/qa-env.mjs';
import { acceptedPackage as acceptedPackageOf, baseFacts } from './lib/commercial.mjs';

const live = JSON.parse(fs.readFileSync(QA_LIVE_FILE, 'utf8'));
const org = live.organization.id;
const U = Object.fromEntries(Object.entries(live.users).map(([k, v]) => [k, v.id]));
const J = (x) => JSON.stringify(x);
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const plus = (n) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

await withQaDb(async (c) => {
  const { one, all } = kit(c);
  const act = async (fn, ...args) => (await one(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).r;
  if (await one(`SELECT id FROM public.projects WHERE organization_id = $1 AND id = 'qa-scn-tucurui'`, [org])) {
    console.log('Cenário já existe (qa-scn-tucurui). Nada a fazer.');
    return;
  }

  // ── Pacote comercial aceito (PT + PC lidas, aprovadas, enviadas, aceitas) — o mesmo helper das provas vivas ──
  const acceptedPackage = (p) => acceptedPackageOf(one, { org, owner: U.owner }, p);
  async function projectFromPackage(p, projectId, projectJson) {
    const pkg = await acceptedPackage(p);
    const gen = await act('internal_service_order_generate_from_package', org, U.gestor, pkg.acceptanceId, J({ os_number: `OS-${p.code}` }));
    const items = await all(`SELECT id FROM public.internal_service_order_items WHERE service_order_id = $1`, [gen.service_order_id]);
    await act('internal_service_order_items_decide', org, U.gestor, gen.service_order_id, J(items.map((i) => ({ item_id: i.id, decision: 'CONFIRMED' }))));
    await one('SELECT public.internal_service_order_issue($1,$2,$3) r', [org, U.gestor, gen.service_order_id]);
    await one('SELECT public.internal_service_order_bind_project($1,$2,$3,$4,$5) r', [org, U.gestor, gen.service_order_id, projectId, J(projectJson)]);
    return { ...pkg, serviceOrderId: gen.service_order_id };
  }

  console.log('▸ projetos pela ponte Comercial → OS → Projeto');
  const P1 = 'qa-scn-tucurui'; const P2 = 'qa-scn-maraba'; const P3 = 'qa-scn-barcarena';
  await projectFromPackage({ code: 'QA-2026-0301', title: 'SE Tucuruí 138 kV — ampliação do pátio', customer: 'Equatorial Pará', value: 4_860_000,
    facts: baseFacts('Ampliação do pátio da SE Tucuruí 138 kV com dois novos bays', 'Relatório de comissionamento dos bays',
      'Concessionária libera o pátio energizado', { label: 'Cabo 35 mm² XLPE', qty: 1200, unit: 'm' }) },
  P1, { nome: 'SE Tucuruí 138 kV — Ampliação do pátio', cliente: 'Equatorial Pará', status: 'em_andamento', cidade: 'Tucuruí', uf: 'PA' });
  await projectFromPackage({ code: 'QA-2026-0288', title: 'LT Marabá–Parauapebas — reforço de estruturas', customer: 'Vale S.A.', value: 2_140_000,
    facts: baseFacts('Reforço de 38 estruturas metálicas da LT 230 kV', 'As-built das estruturas reforçadas',
      'Vale programa os desligamentos da linha', { label: 'Isolador polimérico 138 kV', qty: 240, unit: 'un' }) },
  P2, { nome: 'LT Marabá–Parauapebas — Reforço de estruturas', cliente: 'Vale S.A.', status: 'em_andamento', cidade: 'Marabá', uf: 'PA' });
  await projectFromPackage({ code: 'QA-2026-0256', title: 'Usina Solar Barcarena — comissionamento', customer: 'Hydro Alunorte', value: 1_385_000,
    facts: baseFacts('Comissionamento da usina solar de 5 MWp', 'Termo de aceite do comissionamento',
      'Hydro libera acesso à cabine primária', { label: 'Cabo solar 6 mm²', qty: 5000, unit: 'm' }) },
  P3, { nome: 'Usina Solar Barcarena — Comissionamento', cliente: 'Hydro Alunorte', status: 'em_andamento', cidade: 'Barcarena', uf: 'PA' });

  console.log('▸ OS na ponte: uma em rascunho, uma com divergência bloqueante');
  const pkgDraft = await acceptedPackage({ code: 'QA-2026-0412', title: 'SE Castanhal 69 kV — retrofit de proteção', customer: 'Equatorial Pará', value: 980_000,
    facts: baseFacts('Retrofit do sistema de proteção da SE Castanhal', 'Estudo de seletividade atualizado',
      'Equatorial fornece os ajustes vigentes', { label: 'Relé de proteção digital', qty: 6, unit: 'un' }) });
  await act('internal_service_order_generate_from_package', org, U.gestor, pkgDraft.acceptanceId, J({ os_number: 'OS-QA-2026-0412' }));
  const pkgBlock = await acceptedPackage({ code: 'QA-2026-0397', title: 'LT Belém–Castanhal — travessia do rio Guamá', customer: 'Norte Energia', value: 3_420_000,
    facts: baseFacts('Substituição das torres de travessia do rio Guamá', 'Laudo de estabilidade das torres',
      'Marinha autoriza a interdição do canal', { label: 'Cabo OPGW 24 fibras', qty: 2800, unit: 'm' }) });
  const blocked = await act('internal_service_order_generate_from_package', org, U.gestor, pkgBlock.acceptanceId, J({ os_number: 'OS-QA-2026-0397' }));
  // Divergência BLOQUEANTE apontada pela revisão humana (o valor da OS é o do pacote — não se digita por cima).
  await act('internal_service_order_record_divergence', org, U.gestor, blocked.service_order_id, J({
    scope: 'DATES', field_path: 'planned_finish', severity: 'BLOCKING', detected_by: 'human',
    left_value: '120 dias corridos (PT, p. 14)', right_value: '90 dias corridos (OS)',
    summary: 'Prazo da OS menor que o da proposta técnica aceita: travessia exige janela da Marinha' }));
  await act('internal_service_order_record_divergence', org, U.gestor, blocked.service_order_id, J({
    scope: 'SCOPE', field_path: 'scope', severity: 'WARNING', detected_by: 'human',
    left_value: 'Substituição de 2 torres de travessia', right_value: 'Substituição de 2 torres + reforço de 1 torre de ancoragem',
    summary: 'OS inclui reforço de ancoragem que a PT não prevê' }));

  console.log('▸ OS importada (PDF externo), lida e confrontada com a PT e a PC');
  // O mesmo caminho da tela "Importar OS": PDF no Storage do inquilino → registro → leitura (fatos com página e
  // trecho) → linhas → confronto por regra com a fonte regente. A leitura aqui é a de um documento conhecido:
  // alguns fatos batem com a proposta, um sobra, um falta, um é de baixa confiança e o valor diverge.
  const pkgImport = await acceptedPackage({ code: 'QA-2026-0433', title: 'SE Vila do Conde 230 kV — troca de disjuntores', customer: 'Albras',
    value: 2_150_000, facts: baseFacts('Troca de três disjuntores 230 kV do bay 4', 'Relatório de comissionamento dos disjuntores',
      'Concessionária programa o desligamento do bay 4', { label: 'Disjuntor 230 kV 3150 A', qty: 3, unit: 'un' }) });
  const qaEnv = loadQaEnv();
  const storage = createClient(assertLocal(qaEnv.QA_API_URL, 'QA_API_URL'), qaEnv.QA_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  const osPath = `${org}/service-orders/${randomUUID()}-OS-VDC-0433.pdf`;
  const up = await storage.from('contract-files').upload(osPath, pdf, { contentType: 'application/pdf' });
  if (up.error) throw new Error(`upload da OS: ${up.error.message}`);
  const imported = await act('internal_service_order_register_upload', org, U.gestor, pkgImport.engagementId, J({
    file_path: osPath, content_sha256: createHash('sha256').update(pdf).digest('hex'), file_title: 'OS-VDC-0433.pdf', os_number: 'OS-VDC-0433' }));
  const osFact = (domain, label, extra = {}) => ({ engagement_id: pkgImport.engagementId, document_id: imported.document_id,
    document_context: 'INTERNAL_SERVICE_ORDER', subject_kind: 'internal_service_order', subject_id: imported.service_order_id,
    fact_domain: domain, label, value_text: extra.value_text ?? label, source_page: extra.page ?? 1, source_quote: extra.quote ?? `“${label}”`,
    confidence: extra.confidence ?? 0.93, extraction_method: 'ai', ai_provider: 'qa', ai_model: 'qa-scenario', ai_pipeline_version: 'qa.v1', ...extra });
  for (const f of [
    osFact('SCOPE', 'Troca de três disjuntores 230 kV do bay 4', { page: 1 }),
    osFact('SCOPE', 'Pintura anticorrosiva das estruturas do bay 4', { page: 2, confidence: 0.88 }),
    osFact('RESOURCE', 'Disjuntor 230 kV 3150 A', { value_numeric: 3, unit: 'un', value_text: '3 un', page: 2 }),
    osFact('TEST', 'Ensaio de resistência de contato dos polos', { page: 3, confidence: 0.55,
      quote: '“ensaio de resist... de contato (texto parcialmente ilegível no scan)”' }),
    osFact('DEPENDENCY', 'Concessionária programa o desligamento do bay 4', { page: 3 }),
  ]) await one('SELECT public.commercial_fact_record($1,$2) id', [org, J(f)]);
  await act('internal_service_order_apply_extraction', org, U.gestor, imported.service_order_id);
  // O valor da OS importada é o que o documento declara (tipado pela revisão) — e difere do aceito.
  await act('internal_service_order_update_draft', org, U.gestor, imported.service_order_id, J({ authorized_value: 2_230_000, currency: 'BRL',
    title: 'SE Vila do Conde 230 kV — troca de disjuntores', site_label: 'SE Vila do Conde — Barcarena' }));
  await one('SELECT public.internal_service_order_compare_with_governing($1,$2) r', [org, imported.service_order_id]);

  console.log('▸ cronograma canônico');
  const acts = {};
  const activity = async (project, key, title, start, finish, extra = {}) => {
    const r = await one(`INSERT INTO public.project_timeline_items (organization_id, project_id, title, type, planned_start, planned_finish,
      status, priority, is_milestone, is_summary, is_active, wbs_code, row_order, percent_complete, delay_status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true,$10,$11,$12,$13,$14) RETURNING id`,
      [org, project, title, extra.milestone ? 'milestone' : 'task', start, finish, extra.status ?? 'not_started', extra.priority ?? 'medium',
        Boolean(extra.milestone), extra.wbs ?? null, extra.order ?? 1, extra.pct ?? 0, extra.delay ?? 'on_track', U.gestor]);
    acts[key] = r.id; return r.id;
  };
  await activity(P1, 'p1-mob', 'Mobilização do canteiro', plus(-30), plus(-24), { status: 'completed', pct: 100, wbs: '1.1', order: 1 });
  await activity(P1, 'p1-fund', 'Inspeção das fundações dos bays', plus(-12), plus(-3), { status: 'in_progress', pct: 70, priority: 'high', wbs: '1.2', order: 2, delay: 'delayed' });
  await activity(P1, 'p1-est', 'Montagem das estruturas metálicas', plus(-8), plus(12), { status: 'in_progress', pct: 35, priority: 'high', wbs: '2.1', order: 3 });
  await activity(P1, 'p1-cab', 'Lançamento de cabos de potência', plus(6), plus(20), { priority: 'critical', wbs: '2.2', order: 4 });
  await activity(P1, 'p1-dj', 'Instalação dos disjuntores 145 kV', plus(18), plus(26), { priority: 'critical', wbs: '2.3', order: 5 });
  await activity(P1, 'p1-ene', 'Energização dos novos bays', plus(28), plus(28), { milestone: true, priority: 'critical', wbs: '3', order: 6 });
  await activity(P2, 'p2-des', 'Desligamento programado — trecho 1', plus(3), plus(4), { priority: 'high', wbs: '1.1', order: 1 });
  await activity(P2, 'p2-ref', 'Reforço das estruturas 1–19', plus(-5), plus(15), { status: 'in_progress', pct: 40, priority: 'high', wbs: '1.2', order: 2 });
  await activity(P2, 'p2-iso', 'Troca de isoladores', plus(15), plus(24), { priority: 'high', wbs: '1.3', order: 3 });
  await activity(P2, 'p2-asb', 'Entrega do as-built', plus(30), plus(30), { milestone: true, wbs: '2', order: 4 });
  await activity(P3, 'p3-str', 'Montagem das strings', plus(-15), plus(5), { status: 'in_progress', pct: 80, wbs: '1.1', order: 1 });
  await activity(P3, 'p3-inv', 'Instalação dos inversores', plus(10), plus(16), { priority: 'high', wbs: '1.2', order: 2 });
  await activity(P3, 'p3-com', 'Comissionamento a quente', plus(22), plus(22), { milestone: true, wbs: '2', order: 3 });

  console.log('▸ cadastro de materiais');
  const item = async (code, description, unit, category) =>
    (await act('supply_item_upsert', org, U.engenharia, J({ code, description, unit, category }))).item_id;
  const I = {
    cabo35: await item('CABO-35-XLPE', 'Cabo de potência 35 mm² XLPE 15 kV', 'm', 'Cabos'),
    dj145: await item('DISJ-145KV', 'Disjuntor tripolar 145 kV 2000 A', 'un', 'Equipamentos'),
    isol: await item('ISOL-POL-138', 'Isolador polimérico 138 kV', 'un', 'Isoladores'),
    paraf: await item('PARAF-GALV-M16', 'Parafuso galvanizado M16 × 60', 'un', 'Fixação'),
    solar: await item('CABO-SOLAR-6', 'Cabo solar 6 mm² 1,8 kV', 'm', 'Cabos'),
    inv: await item('INV-250KW', 'Inversor string 250 kW', 'un', 'Equipamentos'),
  };

  console.log('▸ requisitos datados (demanda do Planejamento)');
  const material = async (project, activityKey, itemId, qty, needBy, title) => {
    const r = await act('project_requirement_upsert', org, U.gestor, J({ project_id: project, activity_id: acts[activityKey], requirement_type: 'MATERIAL',
      title, quantity: qty, item_id: itemId, required_by: needBy, priority: 'high' }));
    await act('project_requirement_transition', org, U.gestor, r.requirement_id, 'CONFIRMED', null, null);
    return r.requirement_id;
  };
  const R = {
    cabo35: await material(P1, 'p1-cab', I.cabo35, 1200, plus(6), 'Cabo 35 mm² para o lançamento dos bays'),
    dj145: await material(P1, 'p1-dj', I.dj145, 3, plus(20), 'Disjuntores 145 kV dos novos bays'),
    isol: await material(P2, 'p2-iso', I.isol, 240, plus(15), 'Isoladores para a troca'),
    paraf: await material(P2, 'p2-ref', I.paraf, 2000, plus(2), 'Parafusaria do reforço'),
    solar: await material(P3, 'p3-str', I.solar, 5000, plus(1), 'Cabo solar das strings'),
    inv: await material(P3, 'p3-inv', I.inv, 4, plus(10), 'Inversores de 250 kW'),
  };
  const dep = await act('project_requirement_upsert', org, U.gestor, J({ project_id: P1, activity_id: acts['p1-est'], requirement_type: 'CUSTOMER_DEPENDENCY',
    title: 'Concessionária libera o pátio energizado', required_by: plus(-2), priority: 'critical' }));
  await act('project_requirement_transition', org, U.gestor, dep.requirement_id, 'CONFIRMED', null, null);

  // O resto do que a frente precisa — equipe, documento, equipamento, janela do cliente — para a
  // prontidão por atividade ter as cinco dimensões: pronto, pendente, não confirmado e fora de ordem.
  const need = async (project, activityKey, type, title, needBy, { confirm = true, satisfied = null, priority = 'high', qty = null, unit = null } = {}) => {
    const r = await act('project_requirement_upsert', org, U.gestor, J({ project_id: project, activity_id: acts[activityKey], requirement_type: type,
      title, required_by: needBy, priority, quantity: qty, unit }));
    if (confirm) await act('project_requirement_transition', org, U.gestor, r.requirement_id, 'CONFIRMED', null, null);
    if (satisfied) await act('project_requirement_mark_satisfied', org, U.gestor, r.requirement_id, satisfied, null, false);
    return r.requirement_id;
  };
  await need(P1, 'p1-cab', 'WORKFORCE', 'Equipe de lançamento — 8 eletricistas', plus(5), { qty: 8, unit: 'pessoas',
    satisfied: 'Equipe mobilizada no canteiro, escala confirmada pelo encarregado.' });
  await need(P1, 'p1-dj', 'DOCUMENT', 'Plano de içamento aprovado pelo cliente', plus(14));
  await need(P1, 'p1-dj', 'EQUIPMENT', 'Guindaste 50 t com operador', plus(17), { qty: 1, unit: 'un' });
  await need(P2, 'p2-des', 'DOCUMENT', 'APR e permissão de trabalho do desligamento', plus(2), { confirm: false, priority: 'critical' });
  await need(P2, 'p2-des', 'CUSTOMER_DEPENDENCY', 'Cliente confirma a janela de desligamento', plus(1), { priority: 'critical' });
  await need(P3, 'p3-inv', 'WORKFORCE', 'Equipe de comissionamento dos inversores', plus(12), { qty: 4, unit: 'pessoas' });

  console.log('▸ medições do projeto (regra contratual × cronograma, em todas as raias)');
  // Fixture de LEITURA: a medição canônica (130/134/190) é domínio já provado; aqui ela só precisa existir em cada
  // raia para a fila de Operações ser vista com linhas reais. Nenhuma transição é simulada — cada linha nasce no estado.
  const engagementOf = async (project) => (await one(`SELECT engagement_id FROM public.engagement_project_links
    WHERE organization_id = $1 AND project_id = $2 LIMIT 1`, [org, project])).engagement_id;
  const rule = async (project, title, cadence, basis, reference) => (await one(`INSERT INTO public.contract_measurement_requirements
      (organization_id, engagement_id, title, source_reference, cadence, measurement_basis, accumulation_mode, aggregation_mode,
       evidence_required, customer_acceptance_required, report_required, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,'CUMULATIVE','LATEST_CUMULATIVE',true,true,true,$7) RETURNING id`,
  [org, await engagementOf(project), title, reference, cadence, basis, U.gestor])).id;
  const RM = {
    p1: await rule(P1, 'Boletim mensal de medição — avanço físico', 'MONTHLY', 'PERCENTAGE', 'Contrato, cláusula 7.2 — medição mensal'),
    p2: await rule(P2, 'Medição mensal das estruturas reforçadas', 'MONTHLY', 'PERCENTAGE', 'Contrato, cláusula 6.1 — boletim mensal'),
    p3: await rule(P3, 'Marcos de comissionamento', 'MILESTONE', 'MILESTONE_FIXED', 'Contrato, anexo III — marcos de pagamento'),
  };
  const measurement = async (project, ruleId, key, activityKey, status, expected, extra = {}) => {
    const m = await one(`INSERT INTO public.project_measurements (organization_id, project_id, engagement_id, contract_measurement_rule_id,
        timeline_item_id, occurrence_key, occurrence_state, expected_at, measurement_basis, accumulation_mode, measured_value, currency,
        status, origin, revision, created_by, submitted_at, review_started_at, approved_for_customer_at, sent_to_customer_at, customer_due_at,
        returned_at, return_reason, accepted_at, accepted_value, accepted_currency, acceptance_source, accepted_external_ref)
      VALUES ($1,$2,$3,$4,$5,$6,'resolved',$7,'PERCENTAGE','CUMULATIVE',$8,$9,$10,'manual',1,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
      RETURNING id`, [org, project, await engagementOf(project), ruleId, acts[activityKey], key, expected,
      extra.value ?? null, extra.value ? 'BRL' : null, status, U.gestor, extra.submitted ?? null, extra.review ?? null, extra.approved ?? null,
      extra.sent ?? null, extra.customerDue ?? null, extra.returned ?? null, extra.returnReason ?? null, extra.accepted ?? null,
      extra.accepted ? extra.value : null, extra.accepted ? 'BRL' : null, extra.accepted ? 'signed_bulletin' : null, extra.ref ?? null]);
    if (extra.readiness) {
      await one(`INSERT INTO public.project_measurement_readiness_cache (measurement_id, organization_id, overall, dimensions, reasons, input_fingerprint)
        VALUES ($1,$2,$3,'{}'::jsonb,'[]'::jsonb,'qa-scenario') RETURNING measurement_id`, [m.id, org, extra.readiness]);
    }
    return m.id;
  };
  await measurement(P1, RM.p1, '2026-07', 'p1-mob', 'ACCEPTED', plus(-55), { value: 486_000, submitted: plus(-50), sent: plus(-40), accepted: plus(-30), ref: 'BM-07/2026', readiness: 'READY' });
  await measurement(P1, RM.p1, '2026-08', 'p1-fund', 'AWAITING_CUSTOMER_ACCEPTANCE', plus(-24), { value: 729_000, submitted: plus(-20), review: plus(-18),
    approved: plus(-12), sent: plus(-10), customerDue: plus(-2), readiness: 'READY' });
  await measurement(P1, RM.p1, '2026-09', 'p1-est', 'IN_PREPARATION', plus(6), { readiness: 'INCOMPLETE' });
  await measurement(P2, RM.p2, '2026-08', 'p2-ref', 'RETURNED_FOR_CORRECTION', plus(-20), { value: 312_000, submitted: plus(-12), returned: plus(-3),
    returnReason: 'Fotos das estruturas 14 a 19 sem geolocalização — refazer o registro de campo', readiness: 'BLOCKED' });
  await measurement(P2, RM.p2, '2026-09', 'p2-ref', 'UNDER_REVIEW', plus(-1), { value: 268_000, submitted: plus(-2), review: plus(-1), readiness: 'READY' });
  await measurement(P3, RM.p3, 'M1-strings', 'p3-str', 'APPROVED_FOR_CUSTOMER', plus(-4), { value: 415_500, submitted: plus(-6), review: plus(-5),
    approved: plus(-1), readiness: 'READY' });
  await measurement(P3, RM.p3, 'M2-inversores', 'p3-inv', 'PLANNED', plus(16), {});
  await measurement(P2, RM.p2, '2026-07', 'p2-ref', 'PLANNED', plus(-3), { readiness: 'INCOMPLETE' });

  console.log('▸ estoque, reservas e transferência');
  const L = live.locations;
  const site = async (project, code, name, lat, lng) => (await act('inventory_location_upsert', org, U.almoxarifado, J({ code, name, kind: 'PROJECT_SITE',
    project_id: project, latitude: lat, longitude: lng }))).location_id;
  const S1 = await site(P1, 'CANT-TUCURUI', 'Canteiro SE Tucuruí', -3.7662, -49.6725);
  const S2 = await site(P2, 'CANT-MARABA', 'Canteiro LT Marabá', -5.3686, -49.1178);
  const S3 = await site(P3, 'CANT-BARCARENA', 'Canteiro Usina Barcarena', -1.5059, -48.6255);
  const adjust = (itemId, loc, qty, reason) => act('inventory_adjust', org, U.almoxarifado, J({ item_id: itemId, location_id: loc, quantity: qty, reason }));
  await adjust(I.cabo35, L.central, 300, 'Saldo de implantação — inventário de abertura');
  await adjust(I.cabo35, L.norte, 400, 'Saldo de implantação — inventário de abertura');
  await adjust(I.paraf, L.central, 2500, 'Saldo de implantação — inventário de abertura');
  await adjust(I.solar, L.central, 5200, 'Saldo de implantação — inventário de abertura');
  // Sobra de outra obra: estoque livre que cobre parte de uma falta SEM comprar (transferência).
  await adjust(I.cabo35, S2, 250, 'Sobra do lançamento anterior da LT, devolvida ao estoque do canteiro');
  const reserve = (req, loc, qty) => act('inventory_reserve', org, U.gestor, J({ requirement_id: req, location_id: loc, quantity: qty }));
  await reserve(R.cabo35, L.central, 300);
  await reserve(R.paraf, L.central, 2000);
  await reserve(R.solar, L.central, 5000);
  const tr = await act('inventory_transfer_request', org, U.almoxarifado, J({ from_location_id: L.norte, to_location_id: S1, expected_arrival: plus(2),
    carrier: 'Transportes Tocantins', note: 'Cabo 35 mm² para o lançamento de Tucuruí', lines: [{ item_id: I.cabo35, quantity: 400, requirement_id: R.cabo35 }] }));
  await act('inventory_transfer_approve', org, U.almoxarifado, tr.transfer_id);
  await act('inventory_transfer_dispatch', org, U.almoxarifado, tr.transfer_id, J({ carrier: 'Transportes Tocantins', tracking_ref: 'TT-58812' }));

  console.log('▸ fornecedores e compras');
  const supplierC = (await act('supplier_register', org, U.compras, J({ legal_name: '[QA] Siemens Energy Brasil Ltda', document_type: 'cnpj',
    document_number: '77888999000163', categories: ['Equipamentos'], default_payment_terms: '30/60 dias', default_lead_time_days: 35 }))).supplier_id;
  await act('supplier_set_status', org, U.compras, supplierC, 'HOMOLOGATED', null);
  const SA = live.suppliers.a; const SB = live.suppliers.b;
  async function purchase({ reqs, supplierIds, quotes, choose, delivery, expected, promisedLines, submit = true, approve = true, issue = true }) {
    const rc = await act('purchase_requisition_from_shortage', org, U.compras, J({ requirement_ids: reqs }));
    const lines = await all(`SELECT id FROM public.purchase_requisition_lines WHERE requisition_id = $1`, [rc.requisition_id]);
    const rfq = await act('procurement_rfq_create', org, U.compras, J({ requisition_line_ids: lines.map((l) => l.id), supplier_ids: supplierIds,
      response_due: plus(3) }));
    const rfqLines = await all(`SELECT id FROM public.procurement_rfq_lines WHERE rfq_id = $1`, [rfq.rfq_id]);
    const recorded = {};
    for (const q of quotes) {
      recorded[q.supplier] = (await act('procurement_quote_record', org, U.compras, J({ rfq_id: rfq.rfq_id, supplier_id: q.supplier,
        lead_time_days: q.lead, validity_date: plus(30), freight_amount: q.freight ?? 0, payment_terms: q.terms ?? '28 dias',
        lines: rfqLines.map((l) => ({ rfq_line_id: l.id, unit_price: q.price })) }))).quote_id;
    }
    if (!choose) return { requisitionId: rc.requisition_id, rfqId: rfq.rfq_id };
    const dec = await act('procurement_decide', org, U.compras, J({ rfq_id: rfq.rfq_id, quote_id: recorded[choose],
      rationale: 'Menor custo posto que chega antes da necessidade.' }));
    await act('purchase_order_update_draft', org, U.compras, dec.purchase_order_id, J({ delivery_location_id: delivery, expected_delivery: expected }));
    if (promisedLines) {
      // Tempo decorrido simulado: a promessa por linha (que nasce do prazo da cotação) é antedatada ENQUANTO
      // o pedido é rascunho — o único estado em que linhas mudam; emitido, o gatilho recusa.
      await one(`UPDATE public.purchase_order_lines SET expected_date = $2 WHERE organization_id = $3 AND purchase_order_id = $1 RETURNING id`,
        [dec.purchase_order_id, promisedLines, org]);
    }
    if (submit) await act('purchase_order_submit', org, U.compras, dec.purchase_order_id, 'Emissão conforme cotação');
    if (submit && approve) await act('purchase_order_decide', org, U.financeiro, dec.purchase_order_id, 'APPROVE', 'Dentro da alçada do Financeiro');
    if (submit && approve && issue) await act('purchase_order_issue', org, U.compras, dec.purchase_order_id);
    return { poId: dec.purchase_order_id, rfqId: rfq.rfq_id, requisitionId: rc.requisition_id };
  }
  // Disjuntores: pedido emitido que chega DEPOIS da necessidade.
  const poDj = await purchase({ reqs: [R.dj145], supplierIds: [supplierC], quotes: [{ supplier: supplierC, price: 148_500, lead: 38, freight: 4_800 }],
    choose: supplierC, delivery: S1, expected: plus(25) });
  // Isoladores: pedido emitido, atrasado, parcialmente recebido e com lote em quarentena.
  const poIso = await purchase({ reqs: [R.isol], supplierIds: [SB, SA], quotes: [{ supplier: SB, price: 312.5, lead: 6 }, { supplier: SA, price: 298.9, lead: 18 }],
    choose: SB, delivery: S2, expected: plus(-2), promisedLines: plus(-2) });
  const isoLine = (await one(`SELECT id FROM public.purchase_order_lines WHERE purchase_order_id = $1`, [poIso.poId])).id;
  await act('goods_receipt_post', org, U.almoxarifado, J({ purchase_order_id: poIso.poId, location_id: S2, lines: [{ po_line_id: isoLine, accepted_quantity: 160 }],
    note: 'Primeira entrega — 4 paletes' }));
  await act('goods_receipt_post', org, U.almoxarifado, J({ purchase_order_id: poIso.poId, location_id: L.quarentena,
    lines: [{ po_line_id: isoLine, accepted_quantity: 40 }], note: 'Lote com avaria aparente na embalagem — segue para inspeção' }));
  // Inversores: pedido aguardando a aprovação do Financeiro.
  await purchase({ reqs: [R.inv], supplierIds: [supplierC], quotes: [{ supplier: supplierC, price: 118_900, lead: 20, freight: 2_900 }],
    choose: supplierC, delivery: S3, expected: plus(9), approve: false });
  // Cabo 35 mm²: a falta que sobra vira requisição com cotação aberta e duas propostas.
  await purchase({ reqs: [R.cabo35], supplierIds: [SA, SB],
    quotes: [{ supplier: SA, price: 38.9, lead: 12, freight: 1_200, terms: '28 dias' }, { supplier: SB, price: 41.2, lead: 5, freight: 900, terms: '21 dias' }] });

  console.log('▸ risco material sem dono');
  await one(`INSERT INTO public.risks (organization_id, title, category, probability, impact, severity, origin, reference_id, reference_name, status, due_date, created_by)
    VALUES ($1,'Disjuntor 145 kV chega depois da montagem','supply',4,5,'high','project',$2,'SE Tucuruí 138 kV — Ampliação do pátio','open',$3,$4) RETURNING id`,
    [org, P1, plus(18), U.gestor]).catch((e) => console.warn('  risco não criado:', e.message));

  console.log('▸ leitura da Apex (pelo relógio da plataforma)');
  await one(`SELECT public.supply_intelligence_enqueue_sweep(now() + interval '5000 hours') n`);
  const env = loadQaEnv();
  const res = await fetch(`http://localhost:${env.QA_APP_PORT || 9102}/api/platform/jobs/drain`, { method: 'POST',
    headers: { Authorization: `Bearer ${env.QA_JOBS_SECRET}`, 'x-apex-trigger': 'qa-scenario' } }).catch(() => null);
  console.log(`   drenagem: ${res ? res.status : 'servidor do QA fora do ar — rode a leitura depois'}`);
  console.log(`\n✓ Cenário pronto (hoje = ${TODAY}). Pedidos: disjuntor ${poDj.poId} · isoladores ${poIso.poId}`);
});
