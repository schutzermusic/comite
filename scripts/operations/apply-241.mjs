/**
 * 241 — Decisões: endurecimento após revisão adversarial.
 *
 *   node scripts/operations/apply-241.mjs --target=qa [--apply]
 *   node scripts/operations/apply-241.mjs [--apply]
 *
 * Provas em `scripts/decisions/proofs-241.mjs`; as 120 da 240 continuam valendo
 * (`scripts/decisions/prove.mjs` roda as duas depois de aplicada).
 */
import { runMigration } from './lib/proof-kit.mjs';
import { decisionsProofs } from '../decisions/proofs.mjs';
import { hardeningProofs } from '../decisions/proofs-241.mjs';

await runMigration({
  version: '241',
  expectedTip: '240',
  async proofs(ctx) {
    await hardeningProofs(ctx);
    await decisionsProofs(ctx);
  },
});
