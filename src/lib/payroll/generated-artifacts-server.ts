/**
 * Relatórios gerados do fechamento (relatório executivo, painel) — montados
 * NO SERVIDOR, dos números guardados e da narrativa guardada. Server-only.
 *
 * Antes o navegador montava o HTML e o enviava para virar anexo; esse HTML
 * saía depois por e-mail. Agora o anexo gerado é do servidor, como o corpo.
 */
if (typeof window !== 'undefined') {
  throw new Error('payroll/generated-artifacts-server.ts não pode ser importado no navegador');
}

import { buildEmailHtml, buildExecutiveReportHtml } from '@/lib/payroll/html-builder';
import type { PayrollAttachment } from '@/lib/types/payroll-closing';
import type { PayrollEmailFacts, PayrollRepository, RepoActor } from '@/lib/payroll/repository';

export type GeneratedArtifactType = 'executive_pdf' | 'dashboard_snapshot';
export const GENERATED_ARTIFACT_TYPES: GeneratedArtifactType[] = ['executive_pdf', 'dashboard_snapshot'];

export async function generateBatchArtifacts(
  repo: PayrollRepository, actor: RepoActor, facts: PayrollEmailFacts,
  which: GeneratedArtifactType[] = GENERATED_ARTIFACT_TYPES,
): Promise<PayrollAttachment[]> {
  const month = facts.parse.competence_month.replace(/[^0-9-]/g, '') || 'competencia';
  const out: PayrollAttachment[] = [];
  for (const type of which) {
    const html = type === 'executive_pdf'
      ? buildExecutiveReportHtml(facts.parse, facts.narrative)
      : buildEmailHtml({ parse: facts.parse, narrative: facts.narrative, audience: 'custom' });
    out.push(await repo.addGeneratedAttachment(actor, facts.batch.id, {
      file_name: type === 'executive_pdf' ? `relatorio-executivo-folha-${month}.html` : `dashboard-folha-${month}.html`,
      file_type: type, mime_type: 'text/html', security_level: 'aggregate', bytes: Buffer.from(html, 'utf-8'),
    }));
  }
  return out;
}
