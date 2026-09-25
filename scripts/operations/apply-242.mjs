/**
 * 242 — Notificações: inquilino ativo na RLS, conteúdo imutável, leitura governada.
 *
 *   node scripts/operations/apply-242.mjs --target=qa [--apply]
 *   node scripts/operations/apply-242.mjs [--apply]
 *
 * Provas em `scripts/notifications/proofs-242.mjs`. O preflight grava, antes da
 * migration e na mesma transação, links no formato antigo — para provar a
 * normalização que ela faz.
 */
import { runMigration } from './lib/proof-kit.mjs';
import { legacyCleanup, legacyPreflight, notificationProofs } from '../notifications/proofs-242.mjs';

await runMigration({
  version: '242',
  expectedTip: '241',
  preflight: legacyPreflight,
  cleanup: legacyCleanup,
  async proofs(ctx) {
    await notificationProofs(ctx);
  },
});
