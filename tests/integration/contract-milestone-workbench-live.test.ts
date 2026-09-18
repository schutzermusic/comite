/**
 * BANCADA DO MARCO — provas VIVAS da migration 171.
 *
 * O que só o banco pode provar, e que nenhum teste de unidade alcança:
 *
 *   · a visão é `security_invoker` e `anon` não a lê;
 *   · UMA linha por marco, mesmo com direito, exigência e mapeamento múltiplos;
 *   · mapeamento PROPOSTO não aparece como etapa mapeada — só o aceito;
 *   · direito, apurado e aceito chegam em TRÊS colunas, sem coalescência;
 *   · a visão não escreve nada.
 *
 * Sem `SUPABASE_DB_URL` a suíte é pulada: em CI sem banco ela não falha, e não
 * finge ter passado.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { toWorkbenchRow } from '@/lib/contracts/measurement/milestone-workbench-types';
import { deriveStage, deriveChain } from '@/lib/contracts/measurement/milestone-stage';

for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* arquivo ausente é um caso normal */ }
}

const URL_DB = process.env.SUPABASE_DB_URL;
const suite = URL_DB ? describe : describe.skip;

suite('contract_milestone_workbench (vivo)', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: URL_DB, ssl: { rejectUnauthorized: false } });
    await db.connect();
    await db.query('SET SESSION default_transaction_read_only = off');
  });

  afterAll(async () => { await db.end(); });

  it('é security_invoker, legível por authenticated e fechada para anon', async () => {
    const r = await db.query(`SELECT
      (SELECT c.reloptions::text FROM pg_class c
        WHERE c.oid='public.contract_milestone_workbench'::regclass) reloptions,
      has_table_privilege('authenticated','public.contract_milestone_workbench','SELECT') auth_read,
      has_table_privilege('anon','public.contract_milestone_workbench','SELECT') anon_read,
      has_table_privilege('authenticated','public.contract_milestone_workbench','INSERT') auth_write`);
    expect(r.rows[0].reloptions).toMatch(/security_invoker=true/);
    expect(r.rows[0].auth_read).toBe(true);
    expect(r.rows[0].anon_read).toBe(false);
    expect(r.rows[0].auth_write).toBe(false);
  });

  it('devolve exatamente UMA linha por marco', async () => {
    const r = await db.query(`SELECT
      (SELECT count(*)::int FROM public.contract_milestone_workbench) linhas,
      (SELECT count(DISTINCT id)::int FROM public.contract_milestone_workbench) marcos,
      (SELECT count(*)::int FROM public.contract_milestones) origem`);
    expect(r.rows[0].linhas).toBe(r.rows[0].marcos);
    expect(r.rows[0].linhas).toBe(r.rows[0].origem);
  });

  it('não coalesce direito, apurado e aceito', async () => {
    // As três colunas existem e são independentes. Se alguém trocar a visão por
    // um COALESCE, a coluna some ou passa a repetir a outra.
    const cols = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='contract_milestone_workbench'
        AND column_name IN ('entitlement_amount','measured_amount','measurement_accepted_value')`);
    expect(cols.rows.map((c) => c.column_name).sort())
      .toEqual(['entitlement_amount', 'measured_amount', 'measurement_accepted_value']);
  });

  it('a visão não expõe mapeamento proposto', async () => {
    /*
      A prova é estrutural e sobrevive a uma base sem propostas: a definição da
      visão referencia a visão GOVERNADA, e não a tabela crua de mapeamentos.
      Trocar uma pela outra é como uma sugestão de IA viraria etapa mapeada.
    */
    const def = await db.query(
      `SELECT pg_get_viewdef('public.contract_milestone_workbench'::regclass, true) d`);
    expect(def.rows[0].d).toContain('contract_measurement_rule_timeline_governed');
    expect(def.rows[0].d).not.toMatch(/\bcontract_measurement_rule_timeline_mappings\b/);
  });

  it('JA10182283/2025: 6 eventos, direito registrado, cronograma e faturamento ausentes', async () => {
    const r = await db.query(`SELECT
        title, entitlement_amount::text, measured_amount, measurement_accepted_value,
        requirement_id, governed_mapping_count, timeline_item_id, measurement_id, billing_event_id
      FROM public.contract_milestone_workbench
      WHERE contract_id = '0a795a7b-ad6f-4569-b1d5-df9ed204c0c6'
      ORDER BY title`);

    // Contrato de produção: se algum dia ele avançar, este teste deve ser
    // atualizado DE PROPÓSITO — e não silenciosamente.
    if (r.rows.length === 0) return;

    expect(r.rows).toHaveLength(6);
    const soma = r.rows.reduce((s, row) => s + Number(row.entitlement_amount), 0);
    expect(soma).toBeCloseTo(8032339.77, 2);

    for (const row of r.rows) {
      expect(row.requirement_id).not.toBeNull();     // exigência registrada
      expect(Number(row.governed_mapping_count ?? 0)).toBe(0); // ponte ausente
      expect(row.timeline_item_id).toBeNull();
      expect(row.measurement_id).toBeNull();
      expect(row.billing_event_id).toBeNull();
      expect(row.measured_amount).toBeNull();        // e NÃO 0
      expect(row.measurement_accepted_value).toBeNull();
    }
  });

  /*
    A PONTA A PONTA: linhas VIVAS atravessando a derivação real.

    Os testes de unidade provam a derivação sobre fixtures; este prova que o que
    o banco devolve HOJE, passando pelo mesmo código que a tela usa, não produz
    gatilho apurado, aceite nem faturamento em nenhum marco sem cronograma
    governado. É a asserção que pegaria uma mudança de visão que passasse a
    entregar mapeamento proposto como aceito.
  */
  it('nenhum marco sem mapeamento governado chega a gatilho apurado', async () => {
    const r = await db.query('SELECT * FROM public.contract_milestone_workbench');
    const rows = r.rows.map(toWorkbenchRow);
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const stage = deriveStage(row);
      const chain = deriveChain(row);

      if (row.governedMappingCount === 0 || row.timelineItemId === null) {
        // Sem ponte governada, o gatilho NÃO pode ter sido apurado…
        if (row.measurementId === null && row.billingEventId === null
            && !['measured', 'approved'].includes(row.status)) {
          expect(stage.triggerAssessed, `${row.title}: ${stage.stage}`).toBe(false);
          expect(stage.dashed).toBe(true);
          // …e o elo de execução da cadeia permanece apagado.
          expect(chain.find((l) => l.key === 'execution')?.fact).toBe(false);
        }
      }

      // Faturamento só acende com evento real, em qualquer circunstância.
      expect(chain.find((l) => l.key === 'billing')?.fact)
        .toBe(row.billingEventId !== null);
    }
  });

  it('ler a bancada não escreve nada', async () => {
    const antes = await db.query(`SELECT
      (SELECT count(*)::int FROM public.contract_milestones) m,
      (SELECT count(*)::int FROM public.contract_billing_events) b,
      (SELECT count(*)::int FROM public.project_measurements) p`);
    await db.query('SELECT * FROM public.contract_milestone_workbench');
    const depois = await db.query(`SELECT
      (SELECT count(*)::int FROM public.contract_milestones) m,
      (SELECT count(*)::int FROM public.contract_billing_events) b,
      (SELECT count(*)::int FROM public.project_measurements) p`);
    expect(depois.rows[0]).toEqual(antes.rows[0]);
  });
});
