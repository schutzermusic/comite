/**
 * Verifica as garantias do módulo de ASO contra o esquema JÁ APLICADO (089).
 *
 * Uso: node scripts/verify-aso-schema.mjs
 *
 * POR QUE ISTO EXISTE, E NÃO É TESTE UNITÁRIO
 *
 * As garantias que este módulo vende — "nenhum ASO se auto-aprova",
 * "document_status não pode divergir de review_status" — não moram no
 * TypeScript: moram numa CHECK constraint e num trigger. Teste unitário não
 * alcança nenhum dos dois, e o tipo `AsoDocumentRow` compila feliz descrevendo
 * uma coluna que a migration esqueceu de criar. Foi exatamente esse o caso do
 * `company_cnpj`, que só apareceria no primeiro PDF enviado em produção — e é
 * por isso que a checagem 0 insere o conjunto COMPLETO de colunas que a rota
 * de upload escreve, em vez de um subconjunto conveniente.
 *
 * Tudo roda dentro de uma transação que termina em ROLLBACK: os inserts existem
 * só para provar comportamento, e não sobra linha de teste no acervo de um
 * módulo que guarda dado de saúde.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

function env(key) {
  const txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const u = new URL(process.env.SUPABASE_DB_URL || env('SUPABASE_DB_URL'));
const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, '') || 'postgres',
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const check = (cond, good, wrong) => (cond ? ok(good) : bad(wrong));

await client.connect();
console.log(`Conectado a ${u.hostname}/${client.database}\n`);

try {
  console.log('── Esquema ──');
  const { rows: cols } = await client.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='aso_documents'`,
  );
  const names = cols.map((c) => c.column_name);

  const required = [
    'original_file_url', 'extracted_fields_json', 'reviewed_fields_json',
    'document_status', 'review_status', 'reviewed_by', 'reviewed_at',
    'validity_date', 'validity_basis', 'extraction_confidence', 'extraction_method',
    'esocial_match_status', 'esocial_event_id', 'divergence_summary',
    'review_history', 'occupational_risks', 'clinic_name', 'worker_registration',
    'company_cnpj',
  ];
  const missing = required.filter((c) => !names.includes(c));
  check(missing.length === 0,
    `todos os ${required.length} campos do modelo de dados presentes`,
    `faltam: ${missing.join(', ')}`);

  const legacy = ['status', 'valid_until', 'match_status'].filter((c) => names.includes(c));
  check(legacy.length === 0,
    'nenhum nome antigo sobrou (status / valid_until / match_status foram renomeados)',
    `nomes antigos duplicados: ${legacy.join(', ')}`);

  const { rows: [{ n: trg }] } = await client.query(
    `SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgrelid='public.aso_documents'::regclass AND tgname='aso_documents_touch'`,
  );
  check(trg === 1, 'trigger aso_documents_touch instalado', 'trigger ausente');

  const { rows: cons } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conrelid='public.aso_documents'::regclass`,
  );
  const conNames = cons.map((c) => c.conname);
  for (const c of [
    'aso_documents_review_status_check',
    'aso_documents_document_status_check',
    'aso_documents_esocial_match_status_check',
    'aso_documents_extraction_method_check',
    'aso_documents_approval_needs_reviewer',
  ]) {
    check(conNames.includes(c), `constraint ${c}`, `constraint ${c} AUSENTE`);
  }

  console.log('\n── Comportamento (em transação, com rollback) ──');
  await client.query('BEGIN');

  const { rows: [orgRow] } = await client.query('SELECT id FROM organizations LIMIT 1');
  const { rows: [userRow] } = await client.query('SELECT id FROM auth.users LIMIT 1');
  if (!orgRow) throw new Error('nenhuma organização na base para testar');

  const insert = async (overrides = {}) => {
    const cols = {
      organization_id: orgRow.id,
      file_name: '__check.pdf',
      object_path: `__check/${Math.random()}`,
      original_file_url: 'aso-documents/__check',
      exam_date: '2026-03-10',
      exam_kind: '1',
      exam_result: '1',
      validity_date: '2027-03-10',
      validity_basis: 'declared_document',
      extraction_method: 'text_layer',
      extracted_fields_json: JSON.stringify({ examDate: '2026-03-10' }),
      ...overrides,
    };
    const keys = Object.keys(cols);
    const { rows } = await client.query(
      `INSERT INTO public.aso_documents (${keys.join(',')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})
       RETURNING id, review_status, document_status, esocial_match_status, extraction_method`,
      Object.values(cols),
    );
    return rows[0];
  };

  // 0) A rota de upload escreve TODAS estas colunas. Insere-se o conjunto
  //    inteiro de uma vez: é a checagem que pega coluna prometida no tipo do
  //    TypeScript e esquecida na migration — o erro que só apareceria no
  //    primeiro PDF enviado em produção.
  const rotaEscreve = await insert({
    person_id: null,
    worker_cpf_hash: 'hash',
    worker_name_raw: 'JOSE DA SILVA',
    mime_type: 'application/pdf',
    file_size: 1234,
    checksum: `chk-${Math.random()}`,
    doctor_name: 'Maria Fernanda Souza',
    doctor_crm: '123456',
    company_name: 'INSIGHT ENERGIA LTDA',
    company_cnpj: '12345678000199',
    clinic_name: 'CENTRO MEDICO OCUPACIONAL',
    worker_registration: '004512',
    occupational_risks: JSON.stringify(['ruído']),
    reviewed_fields_json: JSON.stringify({}),
    extraction_confidence: 0.95,
    extraction_issues: JSON.stringify([]),
    esocial_event_id: null,
    esocial_match_status: 'not_imported',
    divergences: JSON.stringify([]),
    divergence_summary: null,
    review_status: 'pending',
    review_history: JSON.stringify([]),
    reviewed_by: null,
    reviewed_at: null,
    notes: null,
    uploaded_by: null,
  });
  ok(`insert com o conjunto COMPLETO de colunas da rota de upload (id=${rotaEscreve.id.slice(0, 8)}…)`);

  // 1) Upload sempre entra pendente, sem passar review_status nenhum.
  const novo = await insert();
  check(novo.review_status === 'pending' && novo.document_status === 'pending_review',
    `upload entra como pending_review (review_status=${novo.review_status})`,
    `upload NÃO entrou pendente: ${JSON.stringify(novo)}`);

  // 2) Conferência com o eSocial é neutra por padrão — não é pendência.
  check(novo.esocial_match_status === 'not_imported',
    'esocial_match_status nasce not_imported (neutro, sem S-2220)',
    `esocial_match_status inesperado: ${novo.esocial_match_status}`);

  // 3) Aprovar sem revisor é recusado pela constraint.
  try {
    await client.query('SAVEPOINT sp1');
    await client.query(
      `UPDATE public.aso_documents SET review_status='approved' WHERE id=$1`, [novo.id],
    );
    bad('APROVOU sem revisor — nenhum ASO pode se auto-aprovar');
    await client.query('ROLLBACK TO SAVEPOINT sp1');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT sp1');
    check(/approval_needs_reviewer/.test(e.message),
      'aprovação sem revisor recusada pela constraint',
      `recusou por outro motivo: ${e.message.split('\n')[0]}`);
  }

  // 4) Aprovar COM revisor funciona e a projeção acompanha.
  if (userRow) {
    const { rows: [aprovado] } = await client.query(
      `UPDATE public.aso_documents
          SET review_status='approved', reviewed_by=$2, reviewed_at=now()
        WHERE id=$1 RETURNING review_status, document_status`,
      [novo.id, userRow.id],
    );
    check(aprovado.document_status === 'approved',
      'aprovação com revisor → document_status=approved',
      `projeção errada: ${JSON.stringify(aprovado)}`);
  } else {
    console.log('  · sem auth.users na base — aprovação com revisor não exercitada');
  }

  // 5) Projeção do trigger para os outros estados, inclusive no INSERT.
  for (const [review, esperado] of [
    ['correction_requested', 'needs_correction'],
    ['rejected', 'rejected'],
    ['pending', 'pending_review'],
  ]) {
    const r = await insert({ review_status: review });
    check(r.document_status === esperado,
      `trigger projeta ${review} → ${esperado} já no INSERT`,
      `projetou ${r.document_status} em vez de ${esperado}`);
  }

  // 6) document_status é derivado: escrevê-lo à mão não vence o trigger.
  const { rows: [forcado] } = await client.query(
    `UPDATE public.aso_documents SET document_status='approved'
      WHERE id=$1 RETURNING review_status, document_status`,
    [novo.id],
  );
  check(forcado.document_status === (forcado.review_status === 'approved' ? 'approved' : 'pending_review'),
    'document_status escrito à mão é sobrescrito pelo trigger (não pode divergir)',
    `divergiu: ${JSON.stringify(forcado)}`);

  // 7) Vocabulários fechados.
  for (const [col, valor] of [
    ['review_status', 'confirmed'],
    ['esocial_match_status', 'no_esocial_event'],
    ['extraction_method', 'deterministic'],
  ]) {
    try {
      await client.query('SAVEPOINT sp2');
      await client.query(`UPDATE public.aso_documents SET ${col}=$2 WHERE id=$1`, [novo.id, valor]);
      bad(`${col} aceitou valor do vocabulário ANTIGO ("${valor}")`);
      await client.query('ROLLBACK TO SAVEPOINT sp2');
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT sp2');
      ok(`${col} recusa o vocabulário antigo ("${valor}")`);
    }
  }

  await client.query('ROLLBACK');
  const { rows: [{ n: sobrou }] } = await client.query(
    `SELECT count(*)::int AS n FROM public.aso_documents WHERE file_name='__check.pdf'`,
  );
  check(sobrou === 0, 'rollback limpo — nenhuma linha de teste no acervo', `${sobrou} linha(s) de teste sobraram`);
} catch (err) {
  failures += 1;
  console.error('\nERRO:', err.message);
  try { await client.query('ROLLBACK'); } catch { /* fora de transação */ }
} finally {
  await client.end();
}

console.log(failures === 0 ? '\nTUDO OK' : `\n${failures} CHECAGEM(NS) FALHOU(RAM)`);
process.exitCode = failures === 0 ? 0 : 1;
