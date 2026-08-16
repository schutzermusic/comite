/**
 * Marca da empresa nos documentos exportados.
 *
 * Dois invariantes:
 *   1. o logo NUNCA distorce — cada destino calcula a caixa a partir da
 *      proporção real, e um logo quadrado tem de sair quadrado mesmo num
 *      espaço largo;
 *   2. o export NUNCA quebra por causa da marca — sem organização, sem logo,
 *      branding desligado ou download falho, cai na marca do produto.
 */
import { describe, expect, it } from 'vitest';
import {
  buildReportBranding,
  fitLogoBox,
  logoBackgroundCss,
  DEFAULT_LOGO_ASPECT,
  FALLBACK_REPORT_BRANDING,
} from '@/lib/reports/report-branding';
import type { BrandingOrganization } from '@/lib/branding';

const org = (over: Partial<BrandingOrganization> = {}): BrandingOrganization =>
  ({
    name: 'Acme Participações',
    workspace_name: 'Acme Board',
    logo_url: 'https://cdn.example/acme.png',
    brand_color: '#7C3AED',
    email_from_name: null,
    notification_name: null,
    branding_enabled: true,
    ...over,
  }) as BrandingOrganization;

const resolved = { dataUri: 'data:image/png;base64,AAAA', aspect: 2.5 };

describe('resolução da marca', () => {
  it('usa o logo da empresa quando existe', () => {
    const b = buildReportBranding(org(), resolved);
    expect(b.isCustomLogo).toBe(true);
    expect(b.logoDataUri).toBe(resolved.dataUri);
    expect(b.companyName).toBe('Acme Participações');
    expect(b.logoAspect).toBe(2.5);
  });

  it('cai na marca do produto sem organização', () => {
    expect(buildReportBranding(null, null)).toBe(FALLBACK_REPORT_BRANDING);
    expect(buildReportBranding(undefined, resolved)).toBe(FALLBACK_REPORT_BRANDING);
  });

  it('cai na marca do produto quando não há logo configurado', () => {
    expect(buildReportBranding(org({ logo_url: '' }), resolved)).toBe(FALLBACK_REPORT_BRANDING);
    expect(buildReportBranding(org({ logo_url: null as never }), resolved)).toBe(
      FALLBACK_REPORT_BRANDING,
    );
  });

  it('cai na marca do produto quando o branding personalizado está desligado', () => {
    expect(buildReportBranding(org({ branding_enabled: false }), resolved)).toBe(
      FALLBACK_REPORT_BRANDING,
    );
  });

  it('cai na marca do produto quando o download do logo falhou', () => {
    // `resolvedLogo` nulo é exatamente o que o hook entrega em erro/CORS.
    expect(buildReportBranding(org(), null)).toBe(FALLBACK_REPORT_BRANDING);
  });

  it('a marca de reserva é sempre renderizável', () => {
    expect(FALLBACK_REPORT_BRANDING.logoDataUri).toMatch(/^data:image\//);
    expect(FALLBACK_REPORT_BRANDING.logoSmallDataUri).toMatch(/^data:image\//);
    expect(FALLBACK_REPORT_BRANDING.logoAspect).toBeGreaterThan(0);
    expect(FALLBACK_REPORT_BRANDING.isCustomLogo).toBe(false);
  });

  it('nunca aceita proporção inválida', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const b = buildReportBranding(org(), { dataUri: resolved.dataUri, aspect: bad });
      expect(b.logoAspect).toBe(DEFAULT_LOGO_ASPECT);
    }
  });

  it('o logo é sempre embutido — nunca uma URL remota', () => {
    const b = buildReportBranding(org(), resolved);
    expect(b.logoDataUri.startsWith('data:')).toBe(true);
    expect(b.logoDataUri).not.toContain('https://');
  });
});

describe('caixa do logo — proporção preservada', () => {
  const wide = buildReportBranding(org(), { dataUri: resolved.dataUri, aspect: 8 });
  const square = buildReportBranding(org(), { dataUri: resolved.dataUri, aspect: 1 });
  const tall = buildReportBranding(org(), { dataUri: resolved.dataUri, aspect: 0.4 });

  it('logo largo é limitado pela LARGURA', () => {
    const box = fitLogoBox(wide, { maxWidth: 4, maxHeight: 1 });
    expect(box.width).toBe(4);
    expect(box.height).toBeCloseTo(0.5, 5);
  });

  it('logo quadrado sai quadrado, mesmo num espaço largo', () => {
    const box = fitLogoBox(square, { maxWidth: 4.6, maxHeight: 0.86 });
    expect(box.width).toBeCloseTo(box.height, 5);
    expect(box.height).toBe(0.86);
  });

  it('logo vertical é limitado pela ALTURA', () => {
    const box = fitLogoBox(tall, { maxWidth: 4, maxHeight: 1 });
    expect(box.height).toBe(1);
    expect(box.width).toBeCloseTo(0.4, 5);
  });

  it('nunca ultrapassa os limites recebidos', () => {
    for (const b of [wide, square, tall, FALLBACK_REPORT_BRANDING]) {
      const box = fitLogoBox(b, { maxWidth: 3, maxHeight: 0.7 });
      expect(box.width).toBeLessThanOrEqual(3 + 1e-9);
      expect(box.height).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });

  it('a proporção da caixa é a proporção da imagem', () => {
    for (const [b, aspect] of [
      [wide, 8],
      [square, 1],
      [tall, 0.4],
    ] as const) {
      const box = fitLogoBox(b, { maxWidth: 5, maxHeight: 2 });
      expect(box.width / box.height).toBeCloseTo(aspect, 5);
    }
  });
});

describe('CSS do logo', () => {
  it('usa contain e no-repeat — nunca estica nem repete', () => {
    const css = logoBackgroundCss('data:image/png;base64,AAAA', {
      height: '46px',
      maxWidth: '300px',
    });
    expect(css).toContain('contain');
    expect(css).toContain('no-repeat');
    expect(css).toContain('height:46px');
    expect(css).not.toContain('cover');
  });

  it('centraliza quando pedido', () => {
    const css = logoBackgroundCss('data:x', { height: '10px', maxWidth: '10px', align: 'center' });
    expect(css).toContain('center center');
  });
});
