/* Gerador de pré-visualização (temporário, fora do suite de asserções). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildInvestorPackPdfHtml } from '@/lib/finance/investor-pack/apex-pdf';
import { buildInvestorPackPresentationHtml } from '@/lib/finance/investor-pack/html-presentation';
import { hydratePortfolioProjection } from '@/lib/finance/investor-pack/portfolio-projection';
import type { InvestorPack } from '@/lib/finance/investor-pack/types';

const base: InvestorPack = {
  id: 'preview',
  organizationId: null,
  parentPackId: null,
  title: 'RELATÓRIO DE FATURAMENTO E RECEBÍVEIS',
  company: 'Insight Energy',
  recipient: 'Investidor',
  periodStart: '2026-01',
  periodEnd: '2026-12',
  currency: 'BRL',
  referenceDate: '2026-07-30',
  confidentiality: 'confidential',
  status: 'published',
  version: 1,
  authorName: 'Financeiro',
  createdBy: null,
  createdAt: '2026-07-30T10:00:00Z',
  updatedAt: '2026-07-30T10:00:00Z',
  publishedAt: '2026-07-30T10:00:00Z',
  months: [],
  narrative: {
    executiveSummary: 'A receita consolidada sustenta a estrutura atual e a carteira prevista amplia a cobertura da folha ao longo do horizonte projetado.',
    highlights: ['Receita em trajetória de crescimento'],
    risks: ['Concentração de faturamento'],
    assumptions: ['Quadro atual mantido'],
    closingMessage: '',
    portfolio: [],
    clientForecasts: [],
    projectionVersion: '',
  },
};

it('gera .preview/pdf.html e .preview/deck.html', () => {
  const pack = hydratePortfolioProjection(base);
  mkdirSync('.preview', { recursive: true });
  writeFileSync('.preview/pdf.html', buildInvestorPackPdfHtml(pack), 'utf8');
  writeFileSync('.preview/pdf-light.html', buildInvestorPackPdfHtml(pack, { theme: 'light' }), 'utf8');
  writeFileSync('.preview/deck.html', buildInvestorPackPresentationHtml(pack), 'utf8');
});
