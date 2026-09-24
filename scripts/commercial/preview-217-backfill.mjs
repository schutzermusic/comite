/**
 * PRÉVIA SOMENTE-LEITURA do backfill da 217 (PT + PC = um contexto).
 *
 * Roda numa transação READ ONLY e termina em ROLLBACK: não aplica a 217, não
 * escreve nada. Reproduz, em SELECT, exatamente a regra do backfill
 * (`commercial_proposal_base_number` + mesmo cliente normalizado + uma
 * TÉCNICA e uma COMERCIAL + sem oportunidade/conta divergente) e lista:
 *
 *   • cada proposta existente, com o contexto proposto e o motivo;
 *   • todo registro AMBÍGUO ou quase-par (mesmo cliente com número-base
 *     diferente, mesmo número-base com cliente diferente, grupo com mais de
 *     uma PT/PC, par barrado por oportunidade/conta, combinada no grupo);
 *   • revisões já ACEITAS (o que o ledger de aceite do pacote precisa cobrir).
 *
 * Sai com código 2 se houver qualquer ambiguidade — a 217 NÃO deve ser
 * aplicada nesse caso.
 *
 *   node scripts/commercial/preview-217-backfill.mjs [--json]
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.local', quiet: true });

const asJson = process.argv.includes('--json');
const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });

// A MESMA expressão da função SQL da 217 e de `baseProposalNumber` (TS).
const BASE = `upper(regexp_replace(regexp_replace(btrim(p.proposal_number),
  '^(PT|PC)([[:space:]._/-]+|(?=[0-9]))', '', 'i'), '[[:space:]]+', '', 'g'))`;
const CP = `lower(regexp_replace(btrim(p.counterparty_name), '[[:space:]]+', ' ', 'g'))`;

try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  const hasContext = (await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='commercial_proposals' AND column_name='context_id'`)).rowCount > 0;
  const tip = (await db.query(`SELECT version FROM supabase_migrations.schema_migrations
    ORDER BY version::int DESC LIMIT 1`)).rows[0]?.version;

  const { rows } = await db.query(`
    WITH cand AS (
      SELECT p.organization_id, p.id, p.proposal_number, p.kind, p.title, p.counterparty_name,
             p.party_id, p.opportunity_id, p.created_at, ${BASE} AS base, ${CP} AS cp,
             o.title AS opportunity_title
        FROM public.commercial_proposals p
        LEFT JOIN public.commercial_opportunities o
          ON o.organization_id = p.organization_id AND o.id = p.opportunity_id
    ), grp AS (
      SELECT organization_id, base, cp,
             array_agg(id ORDER BY created_at, id) FILTER (WHERE kind = 'TECHNICAL')  AS t,
             array_agg(id ORDER BY created_at, id) FILTER (WHERE kind = 'COMMERCIAL') AS c,
             (count(*) FILTER (WHERE kind = 'COMBINED'))::int AS combined
        FROM cand GROUP BY organization_id, base, cp
    )
    SELECT c.*, g.t, g.c, g.combined
      FROM cand c JOIN grp g USING (organization_id, base, cp)
     ORDER BY c.organization_id, c.cp, c.base, c.kind`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  const ambiguous = [];
  for (const r of rows) {
    const t = r.t ?? [];
    const c = r.c ?? [];
    let context = r.id;
    let reason;
    if (r.kind === 'COMBINED') {
      reason = 'COMBINADA — contexto próprio (sempre sozinha)';
      if (t.length || c.length) ambiguous.push({ id: r.id, number: r.proposal_number,
        issue: 'Combinada com PT/PC de mesmo número-base e cliente — pacote duplicado?' });
    } else if (t.length === 1 && c.length === 1) {
      const pt = byId.get(t[0]); const pc = byId.get(c[0]);
      const oppClash = pt.opportunity_id && pc.opportunity_id && pt.opportunity_id !== pc.opportunity_id;
      const partyClash = pt.party_id && pc.party_id && pt.party_id !== pc.party_id;
      if (oppClash || partyClash) {
        reason = `NÃO pareada — ${oppClash ? 'oportunidades' : 'contas'} diferentes`;
        ambiguous.push({ id: r.id, number: r.proposal_number, issue: reason });
      } else {
        context = pt.id;
        reason = `Pareada: mesmo cliente "${r.counterparty_name}", número-base "${r.base}", 1 PT + 1 PC`
          + (r.combined ? ' (há também uma combinada de mesmo número — ver ambíguos)' : '');
        if (r.combined) ambiguous.push({ id: r.id, number: r.proposal_number, issue: 'Par PT/PC coexistindo com combinada de mesmo número-base' });
      }
    } else if (t.length > 1 || c.length > 1) {
      reason = `NÃO pareada — grupo com ${t.length} PT e ${c.length} PC`;
      ambiguous.push({ id: r.id, number: r.proposal_number, issue: reason });
    } else {
      reason = `Sozinha — sem ${r.kind === 'TECHNICAL' ? 'PC' : 'PT'} de mesmo número-base e cliente`;
    }
    out.push({
      id: r.id, number: r.proposal_number, kind: r.kind, customer: r.counterparty_name,
      party_id: r.party_id, opportunity: r.opportunity_id ? `${r.opportunity_title} (${r.opportunity_id})` : null,
      base: r.base, proposed_context: context, reason,
    });
  }

  // Quase-pares: sozinhas que talvez devessem estar juntas.
  const loose = out.filter((o) => o.proposed_context === o.id && o.kind !== 'COMBINED'
    && !ambiguous.some((a) => a.id === o.id));
  for (const a of loose) {
    for (const b of loose) {
      if (a.id >= b.id || a.kind === b.kind) continue;
      const sameCustomer = a.customer.trim().toLowerCase() === b.customer.trim().toLowerCase();
      const baseA = a.base.replace(/[^0-9A-Z]/g, ''); const baseB = b.base.replace(/[^0-9A-Z]/g, '');
      if (sameCustomer && (baseA === baseB || baseA.includes(baseB) || baseB.includes(baseA))) {
        ambiguous.push({ id: `${a.id}+${b.id}`, number: `${a.number} × ${b.number}`,
          issue: 'Quase-par: mesmo cliente, números-base parecidos mas não idênticos — não será agrupado' });
      } else if (!sameCustomer && a.base === b.base) {
        ambiguous.push({ id: `${a.id}+${b.id}`, number: `${a.number} × ${b.number}`,
          issue: 'Quase-par: mesmo número-base com clientes diferentes — não será agrupado' });
      }
    }
  }

  const accepted = (await db.query(`
    SELECT p.proposal_number, r.revision, r.status, r.accepted_at, r.acceptance_source
      FROM public.commercial_proposal_revisions r
      JOIN public.commercial_proposals p ON p.organization_id = r.organization_id AND p.id = r.proposal_id
     WHERE r.status = 'ACCEPTED' ORDER BY r.accepted_at`)).rows;
  const revisions = (await db.query(`
    SELECT p.proposal_number, r.revision, r.status, r.total_value, r.document_id IS NOT NULL AS has_pdf
      FROM public.commercial_proposal_revisions r
      JOIN public.commercial_proposals p ON p.organization_id = r.organization_id AND p.id = r.proposal_id
     ORDER BY p.proposal_number, r.revision`)).rows;

  const contexts = new Set(out.map((o) => o.proposed_context)).size;
  const report = { schema_tip: tip, context_column_exists: hasContext, proposals: out.length,
    contexts_after_backfill: contexts, paired_documents: out.filter((o) => o.proposed_context !== o.id).length,
    rows: out, revisions, accepted_revisions: accepted, ambiguous };

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Ponta do registro: ${tip} · context_id já existe: ${hasContext}`);
    console.log(`${out.length} documento(s) → ${contexts} contexto(s); ${report.paired_documents} documento(s) entram no contexto do par.\n`);
    for (const o of out) {
      console.log(`${o.kind.padEnd(10)} ${o.number}`);
      console.log(`  id:          ${o.id}`);
      console.log(`  cliente:     ${o.customer}${o.party_id ? ` (conta ${o.party_id})` : ' (sem conta do cadastro único)'}`);
      console.log(`  oportunidade:${o.opportunity ? ` ${o.opportunity}` : ' — nenhuma'}`);
      console.log(`  número-base: ${o.base}`);
      console.log(`  contexto:    ${o.proposed_context}${o.proposed_context === o.id ? ' (próprio)' : ''}`);
      console.log(`  motivo:      ${o.reason}\n`);
    }
    console.log('Revisões existentes:');
    for (const r of revisions) console.log(`  ${r.proposal_number} R${String(r.revision).padStart(2, '0')} · ${r.status} · valor ${r.total_value ?? '—'} · PDF ${r.has_pdf ? 'sim' : 'não'}`);
    console.log(`\nRevisões ACEITAS: ${accepted.length}`);
    for (const a of accepted) console.log(`  ${a.proposal_number} R${a.revision} · ${a.accepted_at?.toISOString?.() ?? a.accepted_at} · ${a.acceptance_source}`);
    console.log(`\nAmbíguos / não pareados: ${ambiguous.length}`);
    for (const a of ambiguous) console.log(`  ${a.number}: ${a.issue}`);
  }
  await db.query('ROLLBACK');
  process.exitCode = ambiguous.length ? 2 : 0;
} catch (error) {
  console.error('FALHOU:', error.message);
  try { await db.query('ROLLBACK'); } catch {}
  process.exitCode = 1;
} finally { await db.end(); }
