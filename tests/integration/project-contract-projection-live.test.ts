/**
 * PROVAS VIVAS: contrato → projeto → globo, contra o banco real.
 *
 * Pula em silêncio sem `SUPABASE_DB_URL`, como as demais integrações deste
 * repositório. O que se prova aqui não dá para provar em unidade: que as
 * VISÕES entregam o que os tipos prometem, que a divergência de um centavo
 * sobrevive ao `numeric` do Postgres, e que nada de execução ou de caixa
 * apareceu no caminho.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { toProjectContractFinancial, toProjectContractMilestone } from '@/lib/projects/contract/project-contract-types';
import { deriveExecutionFeedback, triggerAgreesWithView, rollupExecution } from '@/lib/projects/contract/execution-feedback';

for (const f of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é normal em CI */ }
}

const URL_DB = process.env.SUPABASE_DB_URL;
const suite = URL_DB ? describe : describe.skip;

const CONTRACT = 'JA10182283/2025';
const PROJECT_CODE = '2774.08/2025';

suite('projeção contrato→projeto, no banco vivo', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = on');
  }, 30_000);

  afterAll(async () => { await db?.end(); });

  it('as visões são security_invoker e SOMENTE LEITURA', async () => {
    const views = [
      'project_contract_link_governed', 'project_contract_financial_read_model',
      'project_contract_milestone_read_model', 'project_globe_marker',
      'project_location_attention',
      // As cinco que a 174 endureceu.
      'contract_milestone_workbench', 'contract_to_cash_read_model',
      'project_measurement_read_model', 'contract_measurement_rule_timeline_governed',
      'contract_to_cash_health',
    ];
    const { rows } = await db.query(`SELECT c.relname,
        c.reloptions::text opts,
        has_table_privilege('authenticated','public.'||quote_ident(c.relname),'SELECT') a_sel,
        has_table_privilege('authenticated','public.'||quote_ident(c.relname),'INSERT') a_ins,
        has_table_privilege('authenticated','public.'||quote_ident(c.relname),'UPDATE') a_upd,
        has_table_privilege('authenticated','public.'||quote_ident(c.relname),'DELETE') a_del,
        has_table_privilege('anon','public.'||quote_ident(c.relname),'SELECT') anon_sel
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = ANY($1)`, [views]);

    expect(rows).toHaveLength(views.length);
    for (const r of rows) {
      expect(r.opts, r.relname).toContain('security_invoker=true');
      expect(r.a_sel, r.relname).toBe(true);
      expect(r.a_ins, r.relname).toBe(false);
      expect(r.a_upd, r.relname).toBe(false);
      expect(r.a_del, r.relname).toBe(false);
      expect(r.anon_sel, r.relname).toBe(false);
    }
  });

  it('a visão governada de mapeamento continua auto-atualizável — e por isso o grant importa', async () => {
    // A recusa não vem da forma da visão; vem do privilégio. Se um dia ela
    // deixar de ser auto-atualizável, ótimo — mas até lá é o REVOKE que
    // impede converter proposta em verdade aceita por write-through.
    const { rows } = await db.query(`SELECT is_insertable_into
      FROM information_schema.views WHERE table_schema='public'
        AND table_name='contract_measurement_rule_timeline_governed'`);
    expect(rows[0].is_insertable_into).toBe('YES');
    const { rows: p } = await db.query(
      `SELECT has_table_privilege('authenticated','public.contract_measurement_rule_timeline_governed','INSERT') i`);
    expect(p[0].i).toBe(false);
  });

  it('JA10182283/2025 aparece no projeto 2774.08/2025 com o centavo preservado', async () => {
    const { rows } = await db.query(
      `SELECT f.*, p.project->>'codigo' project_code
         FROM public.project_contract_financial_read_model f
         JOIN public.projects p ON p.id = f.project_id
        WHERE f.contract_number = $1`, [CONTRACT]);
    if (rows.length === 0) return;   // base sem o contrato: não falha o CI

    expect(rows).toHaveLength(1);
    expect(rows[0].project_code).toBe(PROJECT_CODE);

    const fin = toProjectContractFinancial(rows[0]);
    expect(fin.contractValue).toBe(8032339.76);
    expect(fin.entitlementTotal).toBe(8032339.77);
    // O centavo é DOCUMENTAL: está no PDF assinado, e não pode ser conciliado
    // por arredondamento em nenhuma camada do caminho.
    expect(fin.reconciliationDelta).toBeCloseTo(0.01, 10);
    expect(fin.milestoneCount).toBe(6);
    expect(fin.linkSource).toBe('contract_project_links');
  });

  it('os 6 marcos chegam ao projeto com direito, percentual e proveniência', async () => {
    const { rows } = await db.query(
      `SELECT m.* FROM public.project_contract_milestone_read_model m
         JOIN public.contracts c ON c.id = m.contract_id
        WHERE c.contract_number = $1 ORDER BY m.title`, [CONTRACT]);
    if (rows.length === 0) return;

    const milestones = rows.map(toProjectContractMilestone);
    expect(milestones).toHaveLength(6);

    for (const m of milestones) {
      expect(m.entitlementAmount).not.toBeNull();
      expect(m.entitlementSourcePage).not.toBeNull();     // proveniência documental
      expect(m.entitlementSourceDocumentId).not.toBeNull();
      expect(m.customerAcceptanceRequired).toBe(true);     // Boletim de Medição
      expect(m.requiredDocumentType).toBe('boletim_medicao');
      expect(m.measurementRequired).toBe(true);
    }

    const share = milestones.reduce((s, m) => s + (m.entitlementSharePercent ?? 0), 0);
    expect(share).toBeCloseTo(100, 4);
    const total = milestones.reduce((s, m) => s + (m.entitlementAmount ?? 0), 0);
    expect(total).toBeCloseTo(8032339.77, 2);
  });

  it('os 6 permanecem NÃO APURADOS — e nada de execução ou caixa foi fabricado', async () => {
    const { rows } = await db.query(
      `SELECT m.* FROM public.project_contract_milestone_read_model m
         JOIN public.contracts c ON c.id = m.contract_id
        WHERE c.contract_number = $1`, [CONTRACT]);
    if (rows.length === 0) return;

    const milestones = rows.map(toProjectContractMilestone);
    for (const m of milestones) {
      expect(m.triggerAssessment).toBe('NOT_ASSESSED');
      expect(deriveExecutionFeedback(m).state).toBe('NOT_ASSESSED');
      // A visão e a tela derivam do mesmo fato, e concordam.
      expect(triggerAgreesWithView(m)).toBe(true);
      expect(m.timelineItemId).toBeNull();
      expect(m.governedMappingCount).toBe(0);
      expect(m.measurementId).toBeNull();
      expect(m.measuredAmount).toBeNull();
      expect(m.acceptedValue).toBeNull();
      expect(m.measurementAcceptedAt).toBeNull();
      expect(m.billingEventId).toBeNull();
    }

    const roll = rollupExecution(milestones);
    expect(roll.assessedCount).toBe(0);
    expect(roll.notAssessedCount).toBe(6);
    expect(roll.eligibleToBillCount).toBe(0);
    expect(roll.billedCount).toBe(0);
    expect(roll.unassessedEntitlement).toBeCloseTo(8032339.77, 2);
  });

  it('o globo tem UM marcador para 2774.08/2025, com proveniência documental', async () => {
    const { rows } = await db.query(`SELECT g.* FROM public.project_globe_marker g
      WHERE g.project_code = $1`, [PROJECT_CODE]);
    if (rows.length === 0) return;   // resolução ainda não executada nesta base

    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m.precision).toBe('site');
    expect(m.site_label).toBe('UHE Cachoeira Dourada');
    // Local OPERACIONAL, extraído do escopo — nunca sede, foro ou cobrança.
    expect(m.evidence_kind).toBe('contract_scope');
    expect(m.source_document_id).not.toBeNull();
    expect(m.source_page).not.toBeNull();
    expect(m.source_contract_id).not.toBeNull();
    expect(Number(m.latitude)).toBeGreaterThan(-19.5);
    expect(Number(m.latitude)).toBeLessThan(-17.5);
    expect(Number(m.longitude)).toBeGreaterThan(-50.5);
    expect(Number(m.longitude)).toBeLessThan(-48.5);
  });

  it('nenhum projeto tem marcador duplicado, e nenhum tem coordenada sem proveniência', async () => {
    const { rows: dup } = await db.query(
      `SELECT project_id FROM public.project_globe_marker GROUP BY 1 HAVING count(*) > 1`);
    expect(dup).toHaveLength(0);

    const { rows: orphan } = await db.query(
      `SELECT project_id FROM public.project_canonical_location
        WHERE resolution_state = 'RESOLVED'
          AND (source_excerpt IS NULL OR site_label IS NULL OR evidence_kind = 'none')`);
    expect(orphan).toHaveLength(0);
  });

  it('projeto sem local de execução apurado fica FORA do globo e DENTRO das pendências', async () => {
    const { rows } = await db.query(
      `SELECT project_code, resolution_state FROM public.project_location_attention`);
    for (const r of rows) {
      expect(['UNRESOLVED', 'REQUIRES_ATTENTION', 'CONFLICT']).toContain(r.resolution_state);
      const { rows: onGlobe } = await db.query(
        `SELECT 1 FROM public.project_globe_marker WHERE project_code = $1`, [r.project_code]);
      expect(onGlobe, `${r.project_code} não deveria estar no globo`).toHaveLength(0);
    }
  });

  it('a localização canônica não é escrevível pelo navegador', async () => {
    const { rows } = await db.query(`SELECT
      has_table_privilege('authenticated','public.project_canonical_location','SELECT') a_sel,
      has_table_privilege('authenticated','public.project_canonical_location','INSERT') a_ins,
      has_table_privilege('authenticated','public.project_canonical_location','UPDATE') a_upd,
      has_table_privilege('authenticated','public.project_canonical_location','DELETE') a_del,
      has_table_privilege('anon','public.project_canonical_location','SELECT') anon_sel,
      (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND relname='project_canonical_location') rls`);
    expect(rows[0]).toMatchObject({
      a_sel: true, a_ins: false, a_upd: false, a_del: false, anon_sel: false, rls: true,
    });
  });

  it('ler as visões não altera contagem nenhuma', async () => {
    const snap = async () => (await db.query(`SELECT
      (SELECT count(*)::int FROM public.contract_milestones) a,
      (SELECT count(*)::int FROM public.contract_billing_events) b,
      (SELECT count(*)::int FROM public.project_measurements) c,
      (SELECT count(*)::int FROM public.contract_measurement_rule_timeline_mappings) d,
      (SELECT count(*)::int FROM public.project_canonical_location) e`)).rows[0];
    const before = await snap();
    await db.query('SELECT * FROM public.project_contract_financial_read_model');
    await db.query('SELECT * FROM public.project_contract_milestone_read_model');
    await db.query('SELECT * FROM public.project_globe_marker');
    expect(await snap()).toEqual(before);
  });
});
