/**
 * 244 — E-mail da folha: endurecimento após verificação adversarial.
 *
 *   node scripts/operations/apply-244.mjs --target=qa [--apply]
 *   node scripts/operations/apply-244.mjs [--apply]
 *
 * Provas em `scripts/payroll/proofs-244.mjs`; as da 243 continuam valendo.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { payrollEmailProofs } from '../payroll/proofs-243.mjs';
import { payrollHardeningProofs } from '../payroll/proofs-244.mjs';

await runMigration({
  version: '244',
  expectedTip: '243',
  async proofs(ctx) {
    await payrollHardeningProofs(ctx);
    await payrollEmailProofs(ctx);
  },
});
