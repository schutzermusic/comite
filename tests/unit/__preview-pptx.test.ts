/* Gerador de pré-visualização do PPTX (temporário, fora do suite de asserções). */
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { it } from 'vitest';
import { buildInvestorPackDeck, generateInvestorPackPptx } from '@/lib/finance/investor-pack/pptx-server';
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

const generator = process.env.OAI_ARTIFACT_TOOL_PATH || path.join(
  os.homedir(),
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs',
);

// Sem o gerador instalado não há o que pré-visualizar — o harness sai de cena.
it.skipIf(!existsSync(generator))('renderiza .preview/pptx/slide-NN.png', async () => {
  const pack = hydratePortfolioProjection(base);
  const mod = await import(/* @vite-ignore */ pathToFileURL(generator).href) as any;
  for (const theme of ['dark', 'light'] as const) {
    const presentation = mod.Presentation.create({ slideSize: { width: 1280, height: 720 } });
    buildInvestorPackDeck(presentation, pack, { theme });

    const dir = theme === 'dark' ? '.preview/pptx' : '.preview/pptx-claro';
    await fs.mkdir(dir, { recursive: true });
    const slides = presentation.slides.items ?? presentation.slides;
    for (let i = 0; i < slides.length; i += 1) {
      const blob = await slides[i].export();
      await fs.writeFile(`${dir}/slide-${String(i + 1).padStart(2, '0')}.png`, Buffer.from(await blob.arrayBuffer()));
    }
    const bytes = await generateInvestorPackPptx(pack, { theme });
    await fs.writeFile(`${dir}/deck.pptx`, bytes);
    console.log(`${theme}: ${slides.length} slides, ${bytes.length} bytes`);
  }
}, 180_000);
