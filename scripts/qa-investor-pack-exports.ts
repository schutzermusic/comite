import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { buildInvestorPackPresentationHtml } from '@/lib/finance/investor-pack/html-presentation';
import { generateInvestorPackPptx } from '@/lib/finance/investor-pack/pptx-server';
import { hydratePortfolioProjection } from '@/lib/finance/investor-pack/portfolio-projection';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';
import { buildInvestorPackPdfHtml } from '@/lib/reports/modules/investor-pack-report';

const outputDir = process.argv[2] || path.join(process.cwd(), 'tmp', 'investor-pack-qa');

const seedPack: InvestorPack = {
  id: 'qa-pack',
  organizationId: null,
  parentPackId: null,
  title: 'Visão Financeira para Investidores',
  company: 'Insight Governança Corporativa',
  recipient: 'Investidor Estratégico',
  periodStart: '2026-01',
  periodEnd: '2026-12',
  currency: 'BRL',
  referenceDate: '2026-07-29',
  confidentiality: 'confidential',
  status: 'published',
  version: 1,
  authorName: 'Diretoria Financeira',
  createdBy: null,
  createdAt: '2026-07-29T12:00:00Z',
  updatedAt: '2026-07-29T12:00:00Z',
  publishedAt: '2026-07-29T12:00:00Z',
  months: Array.from({ length: 12 }, (_, index) => {
    const realized = index < 7;
    return {
      id: `m-${index + 1}`,
      period: `2026-${String(index + 1).padStart(2, '0')}`,
      revenueActualCents: realized ? (720_000_00 + index * 48_000_00) : 0,
      revenueForecastCents: realized ? 0 : (1_020_000_00 + (index - 7) * 72_000_00),
      payrollActualCents: realized ? (410_000_00 + index * 12_000_00) : 0,
      payrollForecastCents: realized ? 0 : 478_000_00,
      note: realized ? 'Competência consolidada' : 'Previsão informada pela diretoria',
    };
  }),
  narrative: {
    executiveSummary: 'A receita consolidada sustenta a estrutura atual e a carteira prevista amplia a cobertura da folha ao longo do segundo semestre.',
    highlights: ['Receita mensal em trajetória de crescimento', 'Cobertura acumulada positiva', 'Previsão baseada na carteira comercial informada'],
    risks: ['Concentração de faturamento em contratos relevantes', 'Deslocamento de marcos pode afetar o calendário'],
    assumptions: ['Manutenção do quadro atual', 'Eventos previstos realizados nas competências informadas', 'Valores apresentados em BRL'],
    closingMessage: 'A prioridade é converter a carteira prevista em faturamento mantendo disciplina sobre o principal custo recorrente: a folha.',
    portfolio: [],
    clientForecasts: [],
    projectionVersion: '',
  },
};
const pack = hydratePortfolioProjection(seedPack);

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const htmlPath = path.join(outputDir, 'pack-investidor.html');
  const pdfHtmlPath = path.join(outputDir, 'pack-investidor-pdf.html');
  const pdfPath = path.join(outputDir, 'pack-investidor.pdf');
  const pptxPath = path.join(outputDir, 'pack-investidor.pptx');
  const htmlDesktopPath = path.join(outputDir, 'html-desktop.png');
  const htmlMobilePath = path.join(outputDir, 'html-mobile.png');

  await fs.writeFile(htmlPath, buildInvestorPackPresentationHtml(pack), 'utf8');
  await fs.writeFile(pdfHtmlPath, buildInvestorPackPdfHtml(pack), 'utf8');
  await fs.writeFile(pptxPath, await generateInvestorPackPptx(pack));

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(pathToFileUrl(pdfHtmlPath), { waitUntil: 'load' });
    await page.pdf({ path: pdfPath, format: 'A4', landscape: true, printBackground: true, preferCSSPageSize: true });
    await page.goto(pathToFileUrl(htmlPath), { waitUntil: 'load' });
    await page.screenshot({ path: htmlDesktopPath });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await mobile.goto(pathToFileUrl(htmlPath), { waitUntil: 'load' });
    await mobile.screenshot({ path: htmlMobilePath });
    await mobile.close();
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ htmlPath, pdfPath, pptxPath, htmlDesktopPath, htmlMobilePath }, null, 2));
}

function pathToFileUrl(filePath: string): string {
  return `file://${filePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
