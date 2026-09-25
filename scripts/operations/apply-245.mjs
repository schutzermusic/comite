/**
 * 245 — Alerta de ASO: destinatários resolvidos no servidor.
 *
 *   node scripts/operations/apply-245.mjs --target=qa [--apply]
 *   node scripts/operations/apply-245.mjs [--apply]
 *
 * Provas em `scripts/workforce/proofs-245.mjs`.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { asoRecipientProofs } from '../workforce/proofs-245.mjs';

await runMigration({
  version: '245',
  expectedTip: '244',
  async proofs(ctx) {
    await asoRecipientProofs(ctx);
  },
});
