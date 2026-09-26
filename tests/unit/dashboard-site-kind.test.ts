/**
 * Tipo de obra do local — src/lib/dashboard/site-kind.ts (puro).
 * Só dirige a representação esquemática 3D; a regra é explicável (`basis`,
 * `matched`) e na dúvida é `generic`.
 */
import { describe, expect, it } from 'vitest';
import { detectSiteKind, GENERIC_SITE_KIND, SITE_KIND_THRESHOLD, SITE_KIND_WEIGHT } from '@/lib/dashboard/site-kind';

const none = { serviceOrderTitles: [], scope: null, items: [] };

describe('detectSiteKind — os projetos do QA', () => {
  it('SE Tucuruí → subestação (nome + OS + disjuntor), com a tensão como contexto', () => {
    const k = detectSiteKind({
      name: 'SE Tucuruí 138 kV — Ampliação do pátio',
      serviceOrderTitles: ['SE Tucuruí 138 kV — ampliação do pátio'],
      scope: null,
      items: [{ code: 'CABO-35-XLPE', description: 'Cabo de potência 35 mm² XLPE 15 kV' },
        { code: 'DISJ-145KV', description: 'Disjuntor tripolar 145 kV 2000 A' }],
    });
    expect(k).toEqual({ kind: 'substation', basis: ['nome', 'OS', 'itens'], matched: ['SE', 'disjuntor', 'DISJ-', '138 kV'] });
  });

  it('LT Marabá–Parauapebas → linha de transmissão (sigla com travessão, isolador)', () => {
    const k = detectSiteKind({
      name: 'LT Marabá–Parauapebas — Reforço de estruturas', serviceOrderTitles: [], scope: null,
      items: [{ code: 'ISOL-POL-138', description: 'Isolador polimérico 138 kV' }, { code: 'PARAF-GALV-M16', description: 'Parafuso galvanizado M16 × 60' }],
    });
    expect(k.kind).toBe('transmission');
    expect(k.basis).toEqual(['nome', 'itens']);
    expect(k.matched).toEqual(expect.arrayContaining(['LT', 'isolador', 'ISOL-']));
  });

  it('Usina Solar Barcarena → solar (nome, cabo solar, inversor)', () => {
    const k = detectSiteKind({
      name: 'Usina Solar Barcarena — Comissionamento', serviceOrderTitles: ['Usina Solar Barcarena — comissionamento'], scope: null,
      items: [{ code: 'CABO-SOLAR-6', description: 'Cabo solar 6 mm² 1,8 kV' }, { code: 'INV-250KW', description: 'Inversor string 250 kW' }],
    });
    expect(k).toMatchObject({ kind: 'solar', basis: ['nome', 'OS', 'itens'] });
    expect(k.matched).toEqual(expect.arrayContaining(['solar', 'SOLAR-', 'inversor', 'INV-']));
    // tensão só é contexto de subestação/linha
    expect(k.matched.some((m) => m.endsWith('kV'))).toBe(false);
  });

  it('"Obra …" sem nenhum termo → genérico', () => {
    expect(detectSiteKind({ name: 'Obra Residencial Alfa — fase 2', ...none })).toEqual(GENERIC_SITE_KIND);
    expect(detectSiteKind({ name: null, ...none })).toEqual(GENERIC_SITE_KIND);
  });

  it('UG-05 (Cachoeira Dourada) → hidrelétrica; eólica pelo nome', () => {
    expect(detectSiteKind({ name: 'Enel Cachoeira Dourada UG-05', ...none }).kind).toBe('hydro');
    expect(detectSiteKind({ name: 'UHE Tucuruí — recapacitação', ...none }).kind).toBe('hydro');
    expect(detectSiteKind({ name: 'Parque Eólico Ventos do Norte', ...none }))
      .toEqual({ kind: 'wind', basis: ['nome'], matched: ['eólico'] });
  });
});

describe('detectSiteKind — as regras', () => {
  it('siglas: só em maiúsculas, em fronteira de palavra; "SE" de Sergipe no fim ou "se" da frase não contam', () => {
    expect(detectSiteKind({ name: 'Obra em Aracaju/SE', ...none }).kind).toBe('generic');
    expect(detectSiteKind({ name: 'Galpão que se estende', ...none }).kind).toBe('generic');
    expect(detectSiteKind({ name: 'OBRA ARACAJU - SE', ...none }).kind).toBe('generic');
    expect(detectSiteKind({ name: 'Ampliação da SE de Tucuruí', ...none }).kind).toBe('substation');
    expect(detectSiteKind({ name: 'SE 230 kV Vila do Conde', ...none }).kind).toBe('substation');
    // a UF seguida de outra palavra em maiúscula continua sendo a UF: "/", "," ou hífen colado antes, ou "Fase/Etapa/Lote" depois
    expect(detectSiteKind({ name: 'Obra Aracaju/SE Fase 2', ...none })).toEqual(GENERIC_SITE_KIND);
    expect(detectSiteKind({ name: 'Obra Aracaju, SE Centro', ...none })).toEqual(GENERIC_SITE_KIND);
    expect(detectSiteKind({ name: 'Obra Aracaju-SE Norte', ...none })).toEqual(GENERIC_SITE_KIND);
    expect(detectSiteKind({ name: 'Obra SE Etapa 2', ...none })).toEqual(GENERIC_SITE_KIND);
    // a usina solar em Sergipe não empata com "subestação" e perde o desenho
    expect(detectSiteKind({ name: 'Parque Solar Canindé/SE Etapa 2', ...none })).toEqual({ kind: 'solar', basis: ['nome'], matched: ['solar'] });
    // travessão com espaço é separador de título, não a UF
    expect(detectSiteKind({ name: 'Enel — SE Cachoeira Dourada', ...none }).kind).toBe('substation');
    expect(detectSiteKind({ name: 'Enel - SE Cachoeira Dourada', ...none }).kind).toBe('substation');
    // "LTDA" não é "LT"; "UG" sem número não é unidade geradora
    expect(detectSiteKind({ name: 'Construtora Norte LTDA', ...none }).kind).toBe('generic');
    expect(detectSiteKind({ name: 'Galpão UG Norte', ...none }).kind).toBe('generic');
  });

  it('palavras sem acento nem caixa ("SUBESTACAO", "linha de transmissao")', () => {
    expect(detectSiteKind({ name: 'AMPLIACAO DA SUBESTACAO CENTRO', ...none }).kind).toBe('substation');
    expect(detectSiteKind({ name: 'Recapacitação da linha de transmissao 230', ...none }).kind).toBe('transmission');
  });

  it('pesos: nome 3 · OS 2 · escopo 1 · item 1; limiar 3 — o nome basta; só itens, ou uma OS sozinha, não', () => {
    expect(SITE_KIND_WEIGHT).toEqual({ nome: 3, OS: 2, escopo: 1, itens: 1 });
    expect(SITE_KIND_THRESHOLD).toBe(3);
    const twoItems = [{ code: 'DISJ-72KV', description: null }, { code: 'SECC-72', description: 'Seccionadora 72,5 kV' }];
    expect(detectSiteKind({ name: 'Obra Beta', serviceOrderTitles: [], scope: null, items: twoItems.slice(0, 1) }).kind).toBe('generic');
    // itens têm teto 2: sozinhos nunca bastam
    expect(detectSiteKind({ name: 'Obra Beta', serviceOrderTitles: [], scope: null, items: twoItems }).kind).toBe('generic');
    expect(detectSiteKind({ name: 'Obra Beta', serviceOrderTitles: [], scope: 'Montagem de seccionadoras', items: twoItems }))
      .toMatchObject({ kind: 'substation', basis: ['escopo', 'itens'] });
    // "Obra …" com UMA OS de subestação continua genérica (o QA: "Obra Ouro …" / "SE Ouro … — dois bays de 138 kV")
    expect(detectSiteKind({ name: 'Obra Ouro MUFXL20623L', serviceOrderTitles: ['SE Ouro MUFXL20623L — dois bays de 138 kV'], scope: null,
      items: [] })).toEqual(GENERIC_SITE_KIND);
    // OS + item, ou duas OS, bastam
    expect(detectSiteKind({ name: 'Contrato 2026/14', serviceOrderTitles: ['LT 500 kV — travessia'], scope: null,
      items: [{ code: 'ISOL-500', description: null }] }))
      .toMatchObject({ kind: 'transmission', basis: ['OS', 'itens'], matched: ['LT', 'travessia', 'ISOL-', '500 kV'] });
    expect(detectSiteKind({ name: 'Contrato 2026/15', serviceOrderTitles: ['UFV Leste — fase 1', 'UFV Leste — fase 2'], scope: null, items: [] }))
      .toMatchObject({ kind: 'solar', basis: ['OS'] });
  });

  it('teto por fonte: muitos itens de outro tipo não vencem o nome', () => {
    const k = detectSiteKind({
      name: 'SE Castanhal 69 kV — retrofit', serviceOrderTitles: [], scope: null,
      items: Array.from({ length: 6 }, (_, i) => ({ code: `INV-${i}`, description: 'Inversor' })),
    });
    expect(k.kind).toBe('substation');
  });

  it('empate no topo com a mesma força → genérico (ambíguo não vira desenho)', () => {
    expect(detectSiteKind({ name: 'SE da UHE Norte', ...none })).toEqual(GENERIC_SITE_KIND);
    // soma maior vence: o nome (3) da usina pesa mais que o escopo (1) da subestação elevadora
    expect(detectSiteKind({ name: 'Usina Solar Leste', serviceOrderTitles: [], scope: 'Subestação elevadora', items: [] }).kind).toBe('solar');
    // mesma soma, fonte mais forte vence: nome (3) × OS (2) + escopo (1)
    expect(detectSiteKind({ name: 'UFV Leste', serviceOrderTitles: ['SE Leste 138 kV'], scope: 'Subestação coletora', items: [] }).kind)
      .toBe('solar');
  });
});
