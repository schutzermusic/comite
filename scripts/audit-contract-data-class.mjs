/**
 * Inventário de proveniência da carteira — SOMENTE LEITURA.
 *
 *   node scripts/audit-contract-data-class.mjs
 *
 * Por que este script existe: `data_class` decide o que a empresa considera sua
 * carteira oficial. Só `live` entra em exposição, saúde, faixa executiva e PDF.
 * Uma classificação errada não produz erro em lugar nenhum — ela produz um
 * número confiante e errado, que é o pior resultado possível.
 *
 * O script NÃO corrige nada e NÃO adivinha nada. Ele lista, marca o que é
 * ambíguo, e devolve a decisão a quem pode tomá-la. Reclassificar é ato de
 * governança e passa por `reclassifyContract`, que exige justificativa e
 * carimba `contract.reclassified` na auditoria.
 *
 * Um contrato marcado `live` por migration anterior NÃO é, por isso, oficial:
 * a marca registra o que alguém afirmou um dia, não uma verificação.
 */
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL ausente no .env/.env.local');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
/*
  Trava de segurança: este script não pode escrever, nem por engano.

  `SET LOCAL` dentro de uma transação, e não `SET` de sessão. A diferença é
  concreta com o pooler do Supabase: um `SET` de sessão sobrevive ao fim do
  script e volta grudado no backend reaproveitado pela próxima conexão — que
  então falha com "cannot execute ALTER TABLE in a read-only transaction" em
  algum lugar sem relação nenhuma com este arquivo. `SET LOCAL` morre no COMMIT.
*/
await client.query('BEGIN');
await client.query('SET LOCAL default_transaction_read_only = on');

const { rows } = await client.query(`
  SELECT c.id, c.contract_number, c.title, c.counterparty_name, c.data_class, c.status,
         c.total_value, c.created_at, c.deleted_at, c.created_by, p.full_name AS created_by_name,
         (SELECT count(*) FROM audit_logs a
           WHERE a.entity_id = c.id AND a.action = 'contract.reclassified') AS reclassifications,
         (SELECT count(*) FROM contract_documents d WHERE d.contract_id = c.id) AS documents
    FROM contracts c
    LEFT JOIN profiles p ON p.user_id = c.created_by
   ORDER BY c.deleted_at NULLS FIRST, c.created_at`);

const brl = (v) => v == null ? '—' :
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

console.log(`\nINVENTÁRIO DE PROVENIÊNCIA — ${rows.length} contrato(s)\n${'═'.repeat(78)}`);

for (const r of rows) {
  console.log(`
  ${r.deleted_at ? '[EXCLUÍDO] ' : ''}${r.title}
    id .............. ${r.id}
    número .......... ${r.contract_number ?? '—'}
    contraparte ..... ${r.counterparty_name ?? '—'}
    data_class ...... ${r.data_class.toUpperCase()}${r.data_class === 'live' ? '   ← entra na carteira OFICIAL' : ''}
    status .......... ${r.status}
    valor ........... ${brl(r.total_value)}
    criado .......... ${new Date(r.created_at).toISOString().slice(0, 10)} por ${r.created_by_name ?? r.created_by ?? '—'}
    documentos ...... ${r.documents}
    reclassificações  ${r.reclassifications}${Number(r.reclassifications) === 0 && r.data_class !== 'unclassified'
      ? '   ← classificado sem ato de governança registrado' : ''}`);
}

// ── ambiguidades: relatadas, nunca resolvidas por heurística ────────────────
const alive = rows.filter((r) => !r.deleted_at);
const ambiguous = [];

for (const r of alive) {
  if (r.data_class === 'live' && Number(r.reclassifications) === 0) {
    ambiguous.push(
      `${r.title} (${r.id}) está LIVE sem nenhum \`contract.reclassified\` na auditoria. ` +
      `A marca veio de backfill de migration ou do caminho de criação antigo, que se autocertificava como oficial. ` +
      `Ninguém afirmou explicitamente que este contrato é da carteira real.`);
  }
}

const dupes = new Map();
for (const r of alive) {
  const key = `${(r.title ?? '').trim().toLowerCase()}|${r.total_value}`;
  dupes.set(key, [...(dupes.get(key) ?? []), r]);
}
for (const [, group] of dupes) {
  if (group.length > 1) {
    ambiguous.push(
      `${group.length} contratos VIVOS com mesmo título e mesmo valor (${group[0].title}): ` +
      `${group.map((g) => g.id).join(', ')}. Qual é o instrumento e qual é duplicata é decisão de negócio.`);
  }
}

console.log(`\n${'═'.repeat(78)}\nRESUMO`);
const by = (c) => rows.filter((r) => r.data_class === c).length;
const byAlive = (c) => alive.filter((r) => r.data_class === c).length;
console.log(`  total ............ ${rows.length}  (vivos: ${alive.length})`);
console.log(`  live ............. ${by('live')}  (vivos: ${byAlive('live')})   ← única classe em métrica oficial`);
console.log(`  demo ............. ${by('demo')}  (vivos: ${byAlive('demo')})`);
console.log(`  unclassified ..... ${by('unclassified')}  (vivos: ${byAlive('unclassified')})`);

if (ambiguous.length) {
  console.log(`\n${'═'.repeat(78)}\nAMBIGUIDADES — ${ambiguous.length} (relatadas, NÃO corrigidas)`);
  for (const a of ambiguous) console.log(`\n  • ${a}`);
  console.log(`\n  Nenhuma foi resolvida por heurística, e nenhuma deve ser.`);
  console.log(`  A correção é humana, via reclassifyContract(id, classe, justificativa).`);
}

console.log(`\n${'═'.repeat(78)}\nNenhum dado foi alterado.\n`);
await client.query('ROLLBACK');
await client.end();
