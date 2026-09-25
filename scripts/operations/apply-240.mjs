/**
 * 240 — Decisões: a caixa de decisões humanas da plataforma.
 *
 *   node scripts/operations/apply-240.mjs --target=qa [--apply]   # QA isolado primeiro
 *   node scripts/operations/apply-240.mjs [--apply]               # banco hospedado
 *
 * Depende de 237/238 (alçada por categoria, submissão com solicitante, rotas
 * ativadas pelo trabalhador) e de 239 (guardas do motor). As provas estão em
 * `scripts/decisions/proofs.mjs` e também rodam sozinhas:
 *
 *   node scripts/decisions/prove.mjs --target=qa
 */
import { runMigration } from './lib/proof-kit.mjs';
import { decisionsProofs } from '../decisions/proofs.mjs';

await runMigration({
  version: '240',
  expectedTip: '239',
  proofs: decisionsProofs,
});
