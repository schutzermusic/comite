/* Temporary preview generator for the project finance PDF report. */
import { writeFileSync } from 'node:fs';
import React from 'react';

(globalThis as unknown as { React: typeof React }).React = React;

async function main() {
  const { projects } = await import('@/lib/mock-data');
  const { loadV2Projects } = await import('@/lib/services/project-migration');
  const { getLedgerEntries } = await import('@/lib/finance/finance-store');
  const { selectProjectFinanceView } = await import('@/lib/finance/selectors/project-finance');
  const { resolveFinanceProjectId } = await import('@/lib/projects/finance-mapping');
  const { buildProjectFinanceReportHtml } = await import('@/lib/projects/export-project-finance-report');

  const v2 = loadV2Projects(projects);
  const project = v2.find((p) => (p.billing_eventogram ?? []).length > 0) ?? v2[0];
  console.log('Preview project:', project.id, project.codigo, project.nome);

  const financeProjectId = resolveFinanceProjectId(project);
  const view = financeProjectId ? selectProjectFinanceView(getLedgerEntries(), financeProjectId) : undefined;
  console.log('financeProjectId:', financeProjectId, '| hasLedgerData:', view?.hasLedgerData);

  const html = buildProjectFinanceReportHtml({
    project,
    ledgerView: view,
    cutoffPeriod: view?.sCurve.cutoffPeriod ?? '',
    logoUrl: 'http://localhost:9002/LOGO%20INSIGHT.png',
  });
  writeFileSync('/tmp/report-preview.html', html);
  console.log('Wrote /tmp/report-preview.html', html.length, 'bytes');
}

main().catch((e) => { console.error(e); process.exit(1); });
