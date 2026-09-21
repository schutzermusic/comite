/**
 * PROVA DE PONTA A PONTA: UM ARQUIVO, UM DOCUMENTO, VÁRIOS CONTEXTOS.
 *
 * ─── Por que esta prova roda no banco, e não no navegador ─────────────────
 *
 * O inquilino que possui JA10182283/2025 (`Insight Energia`) não tem NENHUM
 * usuário em `profiles`: o contrato, o cronograma e os mapeamentos entraram
 * por script de service role. Não existe sessão para abrir, e inventar uma —
 * criando usuário de verdade, ou emitindo sessão para a conta de alguém —
 * seria mexer em identidade de produção para fazer um teste passar.
 *
 * Então a prova desce um nível, até onde a decisão realmente acontece: a RLS.
 * O roteiro cria um membro TEMPORÁRIO do inquilino dentro de uma transação,
 * assume o papel `authenticated` com `request.jwt.claims` — exatamente o que o
 * PostgREST faz a cada requisição —, executa o MESMO INSERT que
 * `uploadProjectFile` emite, e desfaz tudo no fim.
 *
 * O que ela prova: a política aceita o anexo, o vínculo de marco sobrevive, o
 * acervo devolve UM documento com o MESMO id, e o inquilino vizinho não vê
 * nada. O que ela NÃO prova: a subida dos bytes ao Storage — esse caminho é o
 * mesmo `uploadProjectFile` que a aba Documentos e o ImportWizard já usavam
 * antes desta refatoração, e não foi tocado. A política de `storage.objects`
 * é exercida aqui pelo mesmo caminho da RLS.
 *
 * Uso:  node scripts/verify-evidence-canonical-document.mjs [--keep]
 *       Sem --keep, desfaz tudo. `--keep` existe só para depuração manual.
 */
import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const keep = process.argv.includes('--keep');
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error('SUPABASE_DB_URL ausente.'); process.exit(2); }

const CONTRACT_NUMBER = 'JA10182283/2025';
const client = new pg.Client({ connectionString: url });
await client.connect();

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/** Volta ao service role entre os blocos: RESET só funciona fora do papel. */
const asService = () => client.query('RESET ROLE');
const asUser = async (uid) => {
  await client.query("SET LOCAL ROLE authenticated");
  await client.query(
    `SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated', aud: 'authenticated' })],
  );
};

try {
  await client.query('BEGIN');

  // ── O alvo: um marco REAL com ponte aceita ──────────────────────────────
  // Preferimos o marco que JÁ TEM instância de medição: é ele que exercita o
  // caminho inteiro — arquivo, documento canônico e vínculo governado com a
  // medição. Sem nenhum, o roteiro ainda vale, e o vínculo fica para depois.
  const { rows: [target] } = await client.query(`
    SELECT e.organization_id, e.project_id, e.contract_id, e.milestone_id,
           e.title, e.timeline_item_id, e.timeline_wbs_code, e.link_state,
           e.measurement_id, e.measurement_status,
           COALESCE(e.measurement_evidence_count, 0) AS evidencias_antes
      FROM public.project_schedule_contract_events e
     WHERE e.contract_number = $1 AND e.link_state = 'ACCEPTED'
     ORDER BY (e.measurement_id IS NULL), e.title LIMIT 1`, [CONTRACT_NUMBER]);
  if (!target) throw new Error(`nenhum marco ACCEPTED em ${CONTRACT_NUMBER}`);
  console.log(`\nALVO: ${target.title}`);
  console.log(`  marco ${target.milestone_id} · etapa ${target.timeline_wbs_code}`);
  console.log(`  medição canônica: ${target.measurement_id ?? 'ainda não materializada'}`
    + `${target.measurement_status ? ` (${target.measurement_status})` : ''}`);

  const before = await client.query('SELECT count(*)::int n FROM public.project_files');
  const { rows: [baseline] } = await client.query(`
    SELECT (SELECT count(*) FROM public.project_measurements)::int medicoes,
           (SELECT count(*) FROM public.contract_billing_events)::int faturamentos`);

  // ── O membro TEMPORÁRIO do inquilino ────────────────────────────────────
  const uid = crypto.randomUUID();
  const org = target.organization_id;
  await client.query(
    `INSERT INTO auth.users (id, email, aud, role) VALUES ($1, $2, 'authenticated', 'authenticated')`,
    [uid, `verificacao+${uid}@insightapex.local`]);
  await client.query(
    `INSERT INTO public.profiles (user_id, organization_id, full_name) VALUES ($1, $2, 'Verificação 189')`,
    [uid, org]);
  // `profiles` já projeta a filiação por gatilho (PROFILE_PROJECTION). O
  // INSERT abaixo é idempotente porque o gatilho pode ter chegado antes.
  await client.query(
    `INSERT INTO public.organization_memberships (organization_id, user_id, status)
     VALUES ($1, $2, 'ACTIVE') ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [org, uid]);
  await client.query(
    `INSERT INTO public.user_active_organization (user_id, organization_id)
     VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
    [uid, org]);
  await client.query(
    `INSERT INTO public.user_roles (user_id, role_id, organization_id)
     SELECT $1, r.id, $2 FROM public.roles r WHERE r.name = 'Gestor de Projetos' LIMIT 1`,
    [uid, org]);

  // ═══ 1. RBAC: o papel real, sem override nenhum ═══════════════════════
  console.log('\n1) RBAC do Gestor de Projetos');
  await asUser(uid);
  const ctx = await client.query(`
    SELECT public.current_user_organization_id() AS org,
           public.current_user_has_permission('projects.upload') AS pode_subir,
           public.current_user_has_permission('projects.view') AS pode_ver,
           public.current_user_has_permission('contracts.view') AS ve_contrato,
           public.current_user_has_permission('contracts.view_values') AS ve_valores,
           public.current_user_can_view_project_financials() AS ve_financeiro`);
  const r1 = ctx.rows[0];
  check(r1.org === org, 'inquilino resolvido pela sessão', r1.org);
  check(r1.pode_subir === true, 'projects.upload concedido pelo PAPEL');
  check(r1.ve_contrato === true, 'contracts.view concedido');
  console.log(`    contracts.view_values=${r1.ve_valores} · financeiro do projeto=${r1.ve_financeiro}`);

  // ═══ 2. O UPLOAD, exatamente como o cliente o emite ═══════════════════
  console.log('\n2) Anexo de evidência (o INSERT de uploadProjectFile)');
  const objectPath = `${org}/${target.project_id}/${Date.now()}-document-relatorio-de-ensaio.pdf`;

  // A política de storage.objects julga o CAMINHO. Exercida aqui, sob o
  // mesmo papel, porque um caminho que a RLS recusa deixaria a linha de
  // metadados órfã — arquivo sem bytes.
  await client.query(
    `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('project-documents', $1, $2)`,
    [objectPath, uid]);
  check(true, 'storage.objects aceitou o caminho', objectPath.split('/').pop());

  const { rows: [file] } = await client.query(`
    INSERT INTO public.project_files
      (project_id, organization_id, created_by, bucket_id, object_path, public_url,
       file_name, content_type, file_size, category,
       document_type, evidence_category, contract_id, contract_milestone_id,
       measurement_id, timeline_item_id)
    VALUES ($1,$2,$3,'project-documents',$4,NULL,
            'Relatório de ensaio.pdf','application/pdf',48219,'document',
            'measurement_evidence','relatorio_ensaio',$5,$6,
            $8,$7)
    RETURNING id, contract_id, contract_milestone_id, timeline_item_id,
              measurement_id, evidence_category, document_type`,
    [target.project_id, org, uid, objectPath,
     target.contract_id, target.milestone_id, target.timeline_item_id,
     target.measurement_id]);
  check(Boolean(file.id), 'a RLS aceitou o anexo com os vínculos', file.id);

  // ═══ 3. UM arquivo, UM registro ═══════════════════════════════════════
  console.log('\n3) Um arquivo, um registro');
  await asService();
  const after = await client.query('SELECT count(*)::int n FROM public.project_files');
  check(after.rows[0].n === before.rows[0].n + 1,
    'exatamente UMA linha de project_files criada',
    `${before.rows[0].n} → ${after.rows[0].n}`);

  const dup = await client.query(
    `SELECT count(*)::int n FROM public.project_files WHERE object_path = $1`, [objectPath]);
  check(dup.rows[0].n === 1, 'nenhum arquivo duplicado no mesmo caminho');

  const sameMilestone = await client.query(
    `SELECT count(*)::int n FROM public.project_files WHERE contract_milestone_id = $1`,
    [target.milestone_id]);
  check(sameMilestone.rows[0].n === 1, 'uma evidência para o marco — sem segunda cópia');

  // ═══ 4. Traceabilidade preservada ═════════════════════════════════════
  console.log('\n4) Rastreabilidade do documento canônico');
  check(file.contract_milestone_id === target.milestone_id, 'contract_milestone_id preservado');
  check(file.contract_id === target.contract_id, 'contract_id preservado');
  check(file.timeline_item_id === target.timeline_item_id, 'timeline_item_id preservado');
  check(file.evidence_category === 'relatorio_ensaio', 'classe documental preservada');
  check(file.measurement_id === target.measurement_id,
    'measurement_id preservado', String(file.measurement_id));

  // ═══ 5. O MESMO documento nos dois contextos ══════════════════════════
  console.log('\n5) Medições & Evidências e Documentos leem o MESMO id');
  await asUser(uid);

  // Contexto A — a bancada de evidência do marco (listProjectEvidenceByMilestone)
  const bancada = await client.query(`
    SELECT id, file_name, evidence_category FROM public.project_files
     WHERE project_id = $1 AND contract_milestone_id = $2`,
    [target.project_id, target.milestone_id]);
  check(bancada.rows.length === 1, 'a bancada do marco devolve 1 documento');

  // Contexto B — o acervo do projeto (listProjectDocuments)
  const acervo = await client.query(`
    SELECT document_id, origin, evidence_category, contract_milestone_id, object_path
      FROM public.project_document_read_model
     WHERE project_id = $1 AND document_id = $2`,
    [target.project_id, file.id]);
  check(acervo.rows.length === 1, 'o acervo devolve o documento UMA vez');
  check(acervo.rows[0]?.document_id === bancada.rows[0]?.id,
    'document_id IDÊNTICO nos dois contextos', file.id);
  check(acervo.rows[0]?.origin === 'MEASUREMENT_EVIDENCE',
    'procedência classificada como evidência de medição');
  check(acervo.rows[0]?.contract_milestone_id === target.milestone_id,
    'o acervo sabe voltar ao marco (link "Abrir medição")');

  const total = await client.query(
    `SELECT count(*)::int n FROM public.project_document_read_model WHERE project_id = $1 AND document_id = $2`,
    [target.project_id, file.id]);
  check(total.rows[0].n === 1, 'o documento NÃO aparece duas vezes no acervo');

  // Documento contratual continua sem caminho de objeto — referência, não cópia.
  const contratuais = await client.query(`
    SELECT count(*)::int total, count(object_path)::int com_caminho
      FROM public.project_document_read_model
     WHERE project_id = $1 AND origin = 'CONTRACT'`, [target.project_id]);
  check(contratuais.rows[0].com_caminho === 0,
    'documento contratual segue sem caminho de objeto',
    `${contratuais.rows[0].total} referência(s)`);

  // ═══ 5b. O VÍNCULO GOVERNADO com a medição canônica ═══════════════════
  if (target.measurement_id) {
    console.log('\n5b) Vínculo com a medição canônica (RPC governada)');
    // A porta da 191 — a MESMA que a aba chama. Testar a função de 131 aqui
    // provaria um caminho que o navegador não tem.
    const linked = await client.query(
      `SELECT public.project_measurement_attach_document($1, $2, 'TESTS_INSPECTION') AS id`,
      [target.measurement_id, file.id]);
    check(Boolean(linked.rows[0].id), 'a porta governada vinculou o documento à medição');

    // Idempotência: anexar de novo devolve o MESMO vínculo, não um segundo.
    const again = await client.query(
      `SELECT public.project_measurement_attach_document($1, $2, 'TESTS_INSPECTION') AS id`,
      [target.measurement_id, file.id]);
    check(again.rows[0].id === linked.rows[0].id,
      'anexar o mesmo documento duas vezes devolve o mesmo vínculo');

    // A porta de 131 continua fechada para o navegador.
    let negada = false;
    try {
      await client.query('SAVEPOINT direta');
      await client.query(
        `SELECT public.project_measurement_link_evidence($1,'project_file',$2)`,
        [target.measurement_id, file.id]);
      await client.query('RELEASE SAVEPOINT direta');
    } catch {
      negada = true;
      await client.query('ROLLBACK TO SAVEPOINT direta');
    }
    check(negada, 'a função de 131 continua inalcançável pelo navegador');

    await asService();
    const ev = await client.query(
      `SELECT source_type, source_id, evidence_class, link_source, validation_state
         FROM public.project_measurement_evidence WHERE id = $1`, [linked.rows[0].id]);
    const e = ev.rows[0];
    check(e.source_type === 'project_file' && e.source_id === file.id,
      'a evidência aponta para o MESMO documento canônico', file.id);
    check(e.evidence_class === 'RAW_EVIDENCE', 'entrou como evidência BRUTA');
    check(e.validation_state === 'unvalidated',
      'entra NÃO VALIDADA — anexar não valida');

    // O estado a jusante NÃO pode ter se movido por causa de um anexo.
    const depois = await client.query(
      `SELECT status, accepted_at, measured_value FROM public.project_measurements WHERE id = $1`,
      [target.measurement_id]);
    check(depois.rows[0].status === 'PLANNED',
      'a medição continua PLANNED — anexar não mede', depois.rows[0].status);
    check(depois.rows[0].accepted_at === null, 'nenhum aceite registrado pelo anexo');
    check(depois.rows[0].measured_value === null, 'nenhum valor apurado pelo anexo');

    const wb = await client.query(
      `SELECT billing_eligibility_state, billing_event_id FROM public.contract_milestone_workbench WHERE id = $1`,
      [target.milestone_id]);
    check(wb.rows[0].billing_eligibility_state !== 'ELIGIBLE',
      'o marco NÃO virou elegível para faturar',
      String(wb.rows[0].billing_eligibility_state));
    check(wb.rows[0].billing_event_id === null, 'nenhum evento de faturamento criado');

    // E o acervo continua com UM documento — o vínculo não criou cópia.
    const aindaUm = await client.query(
      `SELECT count(*)::int n FROM public.project_files WHERE contract_milestone_id = $1`,
      [target.milestone_id]);
    check(aindaUm.rows[0].n === 1, 'o vínculo não criou um segundo arquivo');
    await asUser(uid);
  }

  // ═══ 6. Fronteiras: inquilino e vínculo cruzado ═══════════════════════
  console.log('\n6) Fronteiras');
  /*
    O marco alheio é buscado como SERVICE ROLE, de propósito.

    Buscá-lo já dentro da sessão do usuário devolvia zero linhas — a RLS o
    escondia — e o teste negativo se auto-pulava em silêncio, passando por
    verde sem ter verificado nada. Um teste que não roda é pior que um teste
    que falha.
  */
  await asService();
  const alheio = await client.query(
    `SELECT id FROM public.contract_milestones WHERE organization_id <> $1 LIMIT 1`, [org]);
  check(alheio.rows.length === 1, 'existe marco de outro inquilino para testar a fronteira');
  await asUser(uid);
  if (alheio.rows.length > 0) {
    let recusado = false;
    try {
      await client.query('SAVEPOINT cross_tenant');
      await client.query(`
        INSERT INTO public.project_files
          (project_id, organization_id, created_by, bucket_id, object_path, file_name,
           category, document_type, contract_milestone_id)
        VALUES ($1,$2,$3,'project-documents',$4,'cross.pdf','document','measurement_evidence',$5)`,
        [target.project_id, org, uid, `${objectPath}.cross`, alheio.rows[0].id]);
      await client.query('RELEASE SAVEPOINT cross_tenant');
    } catch {
      recusado = true;
      await client.query('ROLLBACK TO SAVEPOINT cross_tenant');
    }
    check(recusado, 'vínculo com marco de OUTRO inquilino é recusado pela RLS');
  }

  await asService();
  const vizinho = crypto.randomUUID();
  const { rows: [outraOrg] } = await client.query(
    `SELECT id FROM public.organizations WHERE id <> $1 AND status = 'active' LIMIT 1`, [org]);
  if (outraOrg) {
    await client.query(
      `INSERT INTO auth.users (id, email, aud, role) VALUES ($1,$2,'authenticated','authenticated')`,
      [vizinho, `vizinho+${vizinho}@insightapex.local`]);
    await client.query(
      `INSERT INTO public.profiles (user_id, organization_id, full_name) VALUES ($1,$2,'Vizinho')`,
      [vizinho, outraOrg.id]);
    await client.query(
      `INSERT INTO public.organization_memberships (organization_id, user_id, status)
       VALUES ($1,$2,'ACTIVE') ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [outraOrg.id, vizinho]);
    await client.query(
      `INSERT INTO public.user_active_organization (user_id, organization_id)
       VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id`,
      [vizinho, outraOrg.id]);
    await asUser(vizinho);
    const espiada = await client.query(
      `SELECT count(*)::int n FROM public.project_document_read_model WHERE document_id = $1`, [file.id]);
    check(espiada.rows[0].n === 0, 'o inquilino vizinho não enxerga o documento');
    await asService();
  }

  // ═══ 7. Nada a jusante foi fabricado ══════════════════════════════════
  console.log('\n7) Auditoria de fabricação');
  const fab = await client.query(`
    SELECT (SELECT count(*) FROM public.project_measurements)::int medicoes,
           (SELECT count(*) FROM public.project_measurements WHERE status='ACCEPTED')::int medicoes_aceitas,
           (SELECT count(*) FROM public.project_measurement_evidence)::int evidencias,
           (SELECT count(*) FROM public.contract_billing_events)::int faturamentos,
           (SELECT count(*) FROM public.contract_milestones WHERE status='approved')::int aceites,
           (SELECT count(*) FROM public.contract_milestone_workbench
             WHERE billing_eligibility_state='ELIGIBLE')::int elegiveis`);
  const f = fab.rows[0];
  check(f.medicoes === baseline.medicoes,
    'nenhuma medição criada pelo anexo', `${baseline.medicoes} → ${f.medicoes}`);
  check(f.faturamentos === baseline.faturamentos,
    'eventos de faturamento inalterados', String(f.faturamentos));
  check(f.aceites === 0, 'nenhum aceite registrado', String(f.aceites));
  check(f.medicoes_aceitas === 0, 'nenhuma medição aceita', String(f.medicoes_aceitas));
  check(f.elegiveis === 0, 'nenhum marco elegível para faturar', String(f.elegiveis));

  if (keep && failures === 0) {
    await client.query('COMMIT');
    console.log('\nMANTIDO (--keep). Limpe manualmente.');
  } else {
    await client.query('ROLLBACK');
    console.log('\nDESFEITO — nenhum dado de teste permanece em produção.');
  }
  console.log(failures === 0 ? 'RESULTADO: APROVADO' : `RESULTADO: ${failures} FALHA(S)`);
  if (failures > 0) process.exitCode = 1;
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('\nFALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
