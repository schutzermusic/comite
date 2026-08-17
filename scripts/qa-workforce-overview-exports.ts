/**
 * QA visual dos três destinos de Pessoas & Custos.
 *
 * Gera PDF, apresentação HTML e PowerPoint a partir do MESMO modelo, em dois
 * temas e com três fixtures, e reporta o que só se vê olhando: páginas que
 * transbordam a altura útil, slides que não navegam, marca ausente, e — o mais
 * importante — qualquer `0` aparecendo onde a fonte não respondeu.
 *
 * Três fixtures de propósito:
 *   • completa      — todos os indicadores apurados, para revisar densidade;
 *   • esparsa       — folha sem eSocial e sem receita, para provar que a
 *                     ausência é desenhada como ausência. É o caso que mais
 *                     importa, e o que um harness de fixture única nunca
 *                     exercita;
 *   • marca-cliente — logo quadrado de cliente, para flagrar distorção (a
 *                     marca do produto é 7,5:1, então um 1:1 denuncia esticada).
 *
 * Uso:
 *   npx tsx scripts/qa-workforce-overview-exports.ts [diretório]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

import { buildWorkforceOverviewModel } from '@/lib/workforce/overview/model';
import { buildWorkforceOverviewPdfHtml } from '@/lib/workforce/overview/report/pdf';
import { buildWorkforceOverviewPresentationHtml } from '@/lib/workforce/overview/report/presentation';
import { generateWorkforceOverviewPptx } from '@/lib/workforce/overview/report/pptx-server';
import { EMPTY_ESOCIAL_LINK } from '@/lib/workforce/compliance';
import { buildReportBranding, type ReportBranding } from '@/lib/reports/report-branding';
import type { WorkforceReportTheme } from '@/lib/workforce/overview/types';
import type { WorkforceMonthlyRecord } from '@/lib/workforce/period';

import {
  WORKFORCE_DEMO_SERIES,
  WORKFORCE_SPARSE_SERIES,
} from './fixtures/workforce-demo-series';

const OUT = path.resolve(process.argv[2] ?? 'tmp/workforce-overview-qa');

/**
 * Logo fictício de cliente — QUADRADO (1:1).
 *
 * É o pior caso para distorção: a marca do produto é 7,5:1, então um logo
 * quadrado revela na hora qualquer destino que estique a imagem em vez de
 * respeitar a proporção.
 */
const CLIENT_LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">' +
  '<rect width="200" height="200" rx="24" fill="#7C3AED"/>' +
  '<text x="100" y="122" font-size="86" font-family="sans-serif" font-weight="bold" ' +
  'fill="#fff" text-anchor="middle">AC</text></svg>';

const CLIENT_BRANDING: ReportBranding = buildReportBranding(
  {
    name: 'Acme Participações',
    workspace_name: 'Acme Board',
    logo_url: 'https://cdn.example/acme.svg',
    brand_color: '#7C3AED',
    email_from_name: null,
    notification_name: null,
    branding_enabled: true,
  } as never,
  {
    dataUri: `data:image/svg+xml;base64,${Buffer.from(CLIENT_LOGO_SVG).toString('base64')}`,
    aspect: 1,
  },
);

function model(series: WorkforceMonthlyRecord[], branding?: ReportBranding) {
  return buildWorkforceOverviewModel({
    period: { key: 'current-year' },
    comparison: 'previous-period',
    rawSeries: series,
    approvedBatches: [],
    esocialLink: EMPTY_ESOCIAL_LINK,
    generatedAt: '2026-07-01T12:00:00.000Z',
    branding,
  });
}

const FIXTURES = [
  // Marca do produto (sem logo configurado).
  { name: 'completa', series: WORKFORCE_DEMO_SERIES, branding: undefined },
  { name: 'esparsa', series: WORKFORCE_SPARSE_SERIES, branding: undefined },
  // Marca do cliente, com logo quadrado — prova que nenhum destino distorce.
  { name: 'marca-cliente', series: WORKFORCE_DEMO_SERIES, branding: CLIENT_BRANDING },
] as const;

const THEMES: WorkforceReportTheme[] = ['dark', 'light'];

/**
 * Procura números que a regra do módulo proíbe.
 *
 * Um `R$ 0` ou `0,0%` num documento de board quase sempre significa que um
 * indicador ausente escapou como zero. Rótulo de eixo é a exceção legítima —
 * daí a checagem ignorar o que está dentro de `<text>` de eixo.
 */
function suspiciousZeros(html: string): string[] {
  const body = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
  const hits: string[] = [];
  for (const re of [/>R\$\s*0<\/[a-z]+>/g, />0,0%</g, />0<\/span>/g]) {
    const found = body.match(re);
    if (found) hits.push(...found);
  }
  return hits;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let problems = 0;

  for (const fixture of FIXTURES) {
    const m = model(fixture.series, fixture.branding);

    /* ── PDF, nos dois temas ── */
    for (const theme of THEMES) {
      const html = buildWorkforceOverviewPdfHtml(m, { theme });
      const stem = `pdf-${fixture.name}-${theme}`;
      writeFileSync(path.join(OUT, `${stem}.html`), html);

      // A marca precisa estar EMBUTIDA: uma URL remota quebraria o deck
      // offline e o PDF em `about:blank`.
      if (!html.includes(m.meta.branding.logoDataUri.slice(0, 60))) {
        problems += 1;
        console.error(`✗ ${stem}: logo da marca ausente do documento`);
      }
      // Fontes vêm da origem da aplicação por decisão de `src/lib/fonts.ts`
      // (embutir as TTF somaria 1–2 MB por documento). O que não pode ser
      // remoto é IMAGEM: é ela que aparece quebrada sem rede.
      const remoteImages: string[] = [
        ...(html.match(/url\(['"]?https?:[^)]*\.(png|jpe?g|svg|webp|gif)/gi) ?? []),
        ...(html.match(/<img[^>]+src=["']https?:/gi) ?? []),
      ];
      if (remoteImages.length > 0) {
        problems += 1;
        console.error(`✗ ${stem}: ${remoteImages.length} imagem(ns) remota(s)`);
      }

      const zeros = suspiciousZeros(html);
      if (zeros.length) {
        problems += 1;
        console.error(`✗ ${stem}: ${zeros.length} zero(s) suspeito(s) — ${zeros.slice(0, 3).join(' ')}`);
      }

      const page = await browser.newPage({ viewport: { width: 1240, height: 900 } });
      await page.goto(`file://${path.join(OUT, `${stem}.html`)}`);
      await page.waitForTimeout(500);

      /**
       * Duas checagens, porque uma só não pega o defeito real.
       *
       * `scrollHeight` acusa a folha que cresceu. Mas `.page` é
       * `overflow:hidden` e `.page-inner` é um item flex com `min-height:0`:
       * o conteúdo que não cabe VAZA por cima do rodapé sem que a folha
       * cresça um pixel. Foi assim que a faixa de leitura da página de
       * Eficiência passou a cobrir a marca sem o harness reclamar.
       *
       * A segunda checagem mede o que importa: o filho mais baixo do corpo
       * contra o topo do rodapé.
       */
      const overflow: string[] = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('.page').forEach((el, i) => {
          if (el.scrollHeight > el.clientHeight + 2) {
            out.push(`p${i + 1} cresceu (${el.scrollHeight}>${el.clientHeight})`);
          }
          const inner = el.querySelector('.page-inner');
          const foot = el.querySelector('.pfoot');
          if (!inner || !foot) return;
          const footTop = foot.getBoundingClientRect().top;
          let worst = 0;
          inner.querySelectorAll(':scope > *').forEach((child) => {
            worst = Math.max(worst, child.getBoundingClientRect().bottom - footTop);
          });
          if (worst > 2) out.push(`p${i + 1} invade o rodapé (${Math.round(worst)}px)`);
        });
        return out;
      });
      const pageCount = await page.evaluate(() => document.querySelectorAll('.page').length);

      await page.pdf({
        path: path.join(OUT, `${stem}.pdf`),
        format: 'A4',
        landscape: true,
        printBackground: true,
        preferCSSPageSize: true,
      });
      await page.close();

      if (overflow.length) {
        problems += 1;
        console.error(`✗ ${stem}: transbordo em ${overflow.join(', ')}`);
      } else {
        console.log(`✓ ${stem}: ${pageCount} páginas, sem transbordo`);
      }
    }

    /* ── Deck HTML ── */
    const deck = buildWorkforceOverviewPresentationHtml(m);
    const deckPath = path.join(OUT, `deck-${fixture.name}.html`);
    writeFileSync(deckPath, deck);

    if (!deck.includes(m.meta.branding.logoDataUri.slice(0, 60))) {
      problems += 1;
      console.error(`✗ deck-${fixture.name}: logo da marca ausente`);
    }

    const deckZeros = suspiciousZeros(deck);
    if (deckZeros.length) {
      problems += 1;
      console.error(`✗ deck-${fixture.name}: ${deckZeros.length} zero(s) suspeito(s)`);
    }

    const dp = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const pageErrors: string[] = [];
    dp.on('pageerror', (e) => pageErrors.push(e.message));
    await dp.goto(`file://${deckPath}`);
    // A cascata de entrada do slide leva ~1s (o último degrau abre em .38s e
    // dura .62s). Fotografar antes disso captura o slide pela metade — o que
    // já fez a capa parecer sem a linha de meta.
    await dp.waitForTimeout(1200);

    const slides = await dp.evaluate(() => document.querySelectorAll('.slide').length);
    // Navega o deck inteiro e captura cada slide.
    for (let i = 0; i < slides; i++) {
      await dp.screenshot({ path: path.join(OUT, `deck-${fixture.name}-s${i + 1}.png`) });
      if (i < slides - 1) {
        await dp.keyboard.press('ArrowRight');
        await dp.waitForTimeout(900);
      }
    }
    const counter = await dp.textContent('#counter');
    await dp.close();

    // O contador é zero-padded ("03 / 12"), como no deck da Projeção Financeira.
    const pad = (n: number) => String(n).padStart(2, '0');

    if (pageErrors.length) {
      problems += 1;
      console.error(`✗ deck-${fixture.name}: erro de página — ${pageErrors[0]}`);
    } else if (counter !== `${pad(slides)} / ${pad(slides)}`) {
      problems += 1;
      console.error(`✗ deck-${fixture.name}: navegação parou em "${counter}" de ${slides}`);
    } else {
      console.log(`✓ deck-${fixture.name}: ${slides} slides, navegação completa`);
    }

    /* ── PowerPoint ── */
    try {
      const bytes = await generateWorkforceOverviewPptx(m);
      writeFileSync(path.join(OUT, `deck-${fixture.name}.pptx`), bytes);
      console.log(`✓ deck-${fixture.name}.pptx: ${(bytes.length / 1024).toFixed(0)} KB`);
    } catch (error) {
      // A fixture esparsa é recusada de propósito pela rota (sem competência
      // não há material), mas o gerador em si deve funcionar.
      problems += 1;
      console.error(
        `✗ deck-${fixture.name}.pptx: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await browser.close();

  console.log(`\nArtefatos em ${OUT}`);
  if (problems > 0) {
    console.error(`\n${problems} problema(s) encontrado(s).`);
    process.exit(1);
  }
  console.log('\nNenhum problema encontrado.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
