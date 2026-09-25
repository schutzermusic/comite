/**
 * 243 — E-mail da folha: destinatários governados, envio idempotente.
 *
 *   node scripts/operations/apply-243.mjs --target=qa [--apply]
 *   node scripts/operations/apply-243.mjs [--apply]
 *
 * Provas em `scripts/payroll/proofs-243.mjs`.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { payrollEmailProofs } from '../payroll/proofs-243.mjs';

await runMigration({
  version: '243',
  expectedTip: '242',
  async proofs(ctx) {
    await payrollEmailProofs(ctx);
  },
});
