/**
 * Payroll closing — staging end-to-end smoke test (service role, WRITES data).
 *
 *   PAYROLL_SMOKE_CONFIRM=1 npx tsx scripts/payroll-staging-smoke.ts
 *
 * Exercises the real Supabase repository against the configured project:
 * create batch → upload to secure bucket → verify row/security/checksum/bytes
 * round-trip → generated attachment → save parsed data → save report →
 * create package → record dispatch → approve → sendToFinance (creates finance
 * payroll_batch once) → second sendToFinance must fail (anti-duplication) →
 * verify audit_logs → CLEAN UP everything it created.
 *
 * Guards:
 *  - refuses to run without PAYROLL_SMOKE_CONFIRM=1 (avoids accidental writes);
 *  - never targets production unless you point env at staging on purpose;
 *  - requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL (loaded from
 *    .env.local). Resolve org/user from PAYROLL_SMOKE_ORG_ID / _USER_ID or the
 *    first active profile.
 */

import 'dotenv/config';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { SupabasePayrollRepository } from '../src/lib/payroll/repository/supabase';
import type { PayrollParseResult } from '../src/lib/types/payroll-closing';
import type { RepoActor } from '../src/lib/payroll/repository/types';

function fail(msg: string): never {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}
let passed = 0;
const check = (label: string, cond: boolean) => {
  console.log(`   ${cond ? '✅' : '❌'} ${label}`);
  if (cond) passed++;
  else process.exitCode = 1;
};

async function main() {
  if (process.env.PAYROLL_SMOKE_CONFIRM !== '1') {
    fail('Recusado: defina PAYROLL_SMOKE_CONFIRM=1 para executar (este teste grava dados).');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Resolve actor.
  let organizationId = process.env.PAYROLL_SMOKE_ORG_ID ?? '';
  let userId = process.env.PAYROLL_SMOKE_USER_ID ?? '';
  if (!organizationId || !userId) {
    const { data: prof } = await db.from('profiles').select('user_id, organization_id').not('organization_id', 'is', null).limit(1).maybeSingle();
    if (!prof) fail('Nenhum profile com organization_id encontrado; informe PAYROLL_SMOKE_ORG_ID/_USER_ID.');
    organizationId = organizationId || (prof.organization_id as string);
    userId = userId || (prof.user_id as string);
  }
  const actor: RepoActor = { userId, organizationId };
  console.log(`\n=== Smoke test :: org=${organizationId} user=${userId} ===`);

  const repo = new SupabasePayrollRepository(db);
  let batchId = '';
  let financeBatchId: string | undefined;
  const createdObjects: string[] = []; // "bucket/object_path" pairs to clean up
  try {
    // 1. create batch
    const batch = await repo.createClosingBatch(actor, { competence_month: '2099-12', payment_deadline: '2099-12-28' });
    batchId = batch.id;
    check('createClosingBatch', !!batch.id && batch.status === 'imported');

    // 2. upload a synthetic spreadsheet → secure bucket + rows
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['TOTAL GERAL DA FOLHA', 'R$ 100.000,00']]), 'Resumo');
    const bytes = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    const { attachment } = await repo.addImportFile(actor, batchId, { bytes, file_name: 'smoke-folha.xlsx', file_type: 'payroll_spreadsheet', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    createdObjects.push(attachment.storage_path);
    check('addImportFile → security_level hr_restricted', attachment.security_level === 'hr_restricted');
    check('addImportFile → checksum + size saved', !!attachment.checksum && attachment.file_size === bytes.length);

    // 3. bytes round-trip from Storage
    const round = await repo.getAttachmentBytes(actor, attachment.id);
    check('getAttachmentBytes round-trip', !!round && round.bytes.length === bytes.length);

    // 4. generated attachment
    const gen = await repo.addGeneratedAttachment(actor, batchId, { file_name: 'rel.html', file_type: 'executive_pdf', mime_type: 'text/html', bytes: Buffer.from('<html>ok</html>') });
    createdObjects.push(gen.storage_path);
    check('addGeneratedAttachment', gen.file_type === 'executive_pdf');

    // 5. parsed data
    const parse: PayrollParseResult = {
      competence_month: '2099-12', total_amount_cents: 10000000, previous_month_amount_cents: 9500000,
      variation_amount_cents: 500000, variation_percentage: 5.26, gross_amount_cents: 10000000,
      cost_centers: [{ cost_center_label: 'Smoke CC', amount_cents: 10000000 }], employees: [], bank_lines: [],
      comparison: { current_total_cents: 10000000, previous_total_cents: 9500000, variation_cents: 500000, variation_percentage: 5.26, top_increases: [], top_decreases: [] },
      flags: [], detected_sheets: ['Resumo'], reconciled: true,
    };
    const afterParse = await repo.saveParsedPayrollData(actor, batchId, parse);
    check('saveParsedPayrollData → validated', afterParse.status === 'validated' && afterParse.total_amount_cents === 10000000);

    // 6. report + 7. package + dispatch
    await repo.saveGeneratedReport(actor, batchId, { report_type: 'executive_email', generated_text: 't', generated_html: '<p>t</p>', generated_by_ai: false });
    const pkg = await repo.createEmailPackage(actor, batchId, { audience: 'finance', subject: 'Smoke', html_body: '<p>x</p>', attachment_ids: [attachment.id] });
    const dispatch = await repo.recordDispatch(actor, { package_id: pkg.id, recipients: ['smoke@example.com'], delivery_status: 'simulated', attachments_sent: [{ file_name: attachment.file_name, file_size: attachment.file_size }] });
    check('createEmailPackage + recordDispatch', !!dispatch.id && dispatch.delivery_status === 'simulated');

    // 8. approve + sendToFinance (once)
    await repo.approveClosingBatch(actor, batchId);
    const sent = await repo.sendToFinance(actor, batchId);
    financeBatchId = sent.finance_batch_id;
    check('sendToFinance creates finance batch', sent.ok && !!sent.finance_batch_id);

    // anti-duplication: second call fails
    const again = await repo.sendToFinance(actor, batchId);
    check('sendToFinance anti-duplication blocks 2nd call', !again.ok);

    // 9. audit logs
    const { data: audits } = await db.from('audit_logs').select('action').eq('organization_id', organizationId).eq('entity_id', batchId);
    const actions = new Set((audits ?? []).map((a: { action: string }) => a.action));
    check('audit: created/parsed/approved/sent_to_finance', ['created', 'parsed', 'approved', 'sent_to_finance'].every((a) => actions.has(a)));

    console.log(`\n${process.exitCode ? '⚠️ ' : '✅ '}Smoke checks passed: ${passed}`);
  } finally {
    // CLEAN UP — remove everything this test created.
    console.log('\n=== Limpeza ===');
    if (financeBatchId) await db.from('payroll_batch').delete().eq('id', financeBatchId);
    // Remove uploaded storage objects (path = "bucket/object_path").
    for (const full of createdObjects) {
      const slash = full.indexOf('/');
      const bucket = full.slice(0, slash);
      const objectPath = full.slice(slash + 1);
      const { error } = await db.storage.from(bucket).remove([objectPath]);
      if (error) console.log(`   ⚠️ storage remove falhou (${bucket}): ${error.message}`);
    }
    if (batchId) {
      await db.from('audit_logs').delete().eq('entity_id', batchId);
      await db.from('payroll_closing_batches').delete().eq('id', batchId); // cascades child rows
      console.log('   removidos: storage objects, closing batch (cascade), finance batch, audit logs');
    }
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
