/**
 * PLANEJAMENTO DE MATERIAIS · o painel do requisito diante da regra 246:
 *
 *   Pendente     a transferência pedida (sem despacho) não é cobertura e fica
 *                fora da compra — ANTES da exceção;
 *   Sobreposto   DEPOIS da exceção de cobertura, a parte pendente JÁ foi
 *                comprada: o painel diz quanto, que chega em dobro se a
 *                transferência também for despachada, e o caminho (cancelar
 *                no Estoque) — nunca "fica fora da compra";
 *   Aviso        o toast da exceção sai do que o BANCO devolveu: sem
 *                transferência pendente no meio-tempo, ele requisita sem
 *                exceção — e o aviso nunca diz "a exceção ficou registrada".
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Props = Record<string, unknown> & { children?: React.ReactNode };
const h = React.createElement;

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: Props & { href: string }) => h('a', { href, ...rest }, children),
}));
vi.mock('@/components/hud', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/hud')>()),
  useHudToast: () => toast,
}));
vi.mock('@/components/ax', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ax')>()),
  // O painel do Radix vai para um portal (nada no HTML do servidor): aqui, só o conteúdo.
  SidePanel: ({ children, testId }: Props & { testId?: string }) => h('div', { 'data-testid': testId }, children),
}));

import { useGovernedAction } from '@/components/ax';
import { RequirementPanel, exceptionNotice, type DemandCaps } from '@/components/supply/planning/RequirementPanel';
import { summarizeCoverage } from '@/lib/supply/coverage';
import type { MaterialDemandRow } from '@/lib/supply/read-model';

const TODAY = '2026-09-26';
const TR = { transferId: 'tr-b71b7', number: 'TR-260925-B71B7', status: 'REQUESTED', statusLabel: 'Solicitada', qty: 150,
  href: '/supply/estoque?view=transferencias&transfer=tr-b71b7' };
/* qa-flx-*: 500 m, 100 reservados, TR de 150 m PEDIDA → falta 400, comprável 250. */
const ROW: MaterialDemandRow = {
  requirementId: 'req-flx', projectId: 'qa-flx', project: '[QA] FLX', client: null, activityId: null, activity: null,
  itemId: 'c502', itemCode: 'CABO-35-XLPE', itemDescription: 'Cabo de potência 35 mm² XLPE 15 kV', title: 'Cabo 35 mm²',
  priority: 'high', unit: 'm', requirementType: 'MATERIAL', requiredBy: '2026-10-10', activityStart: null, needBy: '2026-10-10', daysToNeed: 14,
  coverage: summarizeCoverage({ required: 500, reserved: 100, pendingTransfer: 150, purchasable: 250 }),
  risk: 'high', pendingTransfers: [TR], stock: [], itemStock: null, sites: [{ id: 'cant-flx', name: 'Canteiro FLX' }],
};
/* O fim do E2E 13 (qa-flx-*-exc): a exceção comprou os 400 m — requisitado 400, pendente 400, comprável 0. */
const AFTER_EXC: MaterialDemandRow = {
  ...ROW,
  coverage: summarizeCoverage({ required: 500, reserved: 100, requested: 400, pendingTransfer: 400, purchasable: 0 }),
  pendingTransfers: [{ ...TR, qty: 400 }],
};
const CAPS: DemandCaps = { plan: true, reserve: true, transfer: true, requestPurchase: true, inventory: true, coverageOverride: true };
const panel = (row: MaterialDemandRow) => renderToStaticMarkup(h(RequirementPanel, {
  row, today: TODAY, caps: CAPS, apex: null, signal: null, onClose: () => undefined, onApex: () => undefined,
}));

describe('Planejamento · painel do requisito: a transferência pedida antes e depois da exceção', () => {
  it('antes da exceção: pendente, fora da compra, e a exceção oferecida a quem tem a alçada', () => {
    const html = panel(ROW);
    expect(html).toContain('data-testid="demand-pending-transfer"');
    expect(html).toContain('Ainda não saiu da origem: não conta como cobertura (a falta continua) e fica fora da compra.');
    expect(html).toContain('não é cobertura — não sai da falta — e não é comprada de novo.');
    expect(html).toContain('data-testid="coverage-exception"');
    expect(html).not.toContain('data-overlap');
    expect(html).not.toContain('demand-pending-overlap');
  });

  it('depois da exceção: JÁ comprada — quanto, "chega em dobro", cancelar no Estoque; nunca "fica fora da compra"', () => {
    const html = panel(AFTER_EXC);
    expect(html).toContain('data-overlap="true"');
    expect(html).toContain('data-testid="demand-pending-overlap"');
    expect(html).toContain('já foi comprada: os 400 m entraram numa solicitação de compra por exceção de cobertura');
    expect(html).toContain('o material chega em dobro');
    expect(html).toContain('cancele-a no Estoque em “Resolver a transferência”');
    expect(html).toContain('>Resolver a transferência</a>');
    // a nota da equação também
    expect(html).toContain('400 m dela já foram comprados por exceção de cobertura: se a transferência também for despachada, chegam em dobro.');
    expect(html).not.toContain('fica fora da compra');
    expect(html).not.toContain('não é comprada de novo');
    // nada mais a pedir: nem exceção, nem "compra bloqueada"
    expect(html).not.toMatch(/data-testid="coverage-exception"|demand-purchase-blocked|NaN|undefined/);
  });
});

describe('Planejamento · o aviso da exceção é o que o BANCO fez', () => {
  let calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const respond = (status: number, payload: unknown) => vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(payload), { status });
  }));
  type Act = ReturnType<typeof useGovernedAction>['run'];
  type Run = (body: Record<string, unknown>) => Promise<boolean>;
  function Probe({ onRun }: { onRun: (run: Act) => void }) { onRun(useGovernedAction().run); return null; }
  /** O ato do painel (o hook governado + o aviso do BANCO), capturado num render de servidor (o `busy` fora do render é inerte). */
  const runOf = (): Run => {
    const got: Act[] = [];
    renderToStaticMarkup(h(Probe, { onRun: (run: Act) => { got.push(run); } }));
    const act = got[0];
    if (!act) throw new Error('hook não rodou');
    return async (body) => (await act('coverage-exception:req-flx', '/api/supply/procurement/requisitions', body, exceptionNotice('m'))).ok;
  };
  const BODY = { source: 'SHORTAGE', requirementIds: ['req-flx'], coverageOverride: { reason: 'A origem só libera o cabo em novembro.' } };

  beforeEach(() => { calls = []; toast.success.mockReset(); toast.error.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('exceção usada: "com exceção de cobertura", a quantidade requisitada e o registro', async () => {
    respond(200, { ok: true, result: { requisition_number: 'RC-260926-EXC01', requisitioned_qty: '400.0000', override: true, replayed: false } });
    expect(await runOf()(BODY)).toBe(true);
    expect(calls[0].url).toBe('/api/supply/procurement/requisitions');
    expect(calls[0].body).toMatchObject({ ...BODY, idempotencyKey: expect.any(String) });
    expect(toast.success).toHaveBeenCalledWith('Compra requisitada com exceção de cobertura',
      'RC-260926-EXC01 · 400 m: a exceção ficou registrada; a requisição segue para cotação em Compras.');
  });

  it('a transferência saiu no meio-tempo: o banco requisita SEM exceção — o aviso diz isso, nunca "a exceção ficou registrada"', async () => {
    respond(200, { ok: true, result: { requisition_number: 'RC-260926-B0002', requisitioned_qty: 250, override: false, replayed: false } });
    expect(await runOf()(BODY)).toBe(true);
    const [title, detail] = toast.success.mock.calls[0] as [string, string];
    expect(title).toBe('Compra requisitada sem exceção de cobertura');
    expect(detail).toContain('A transferência já não estava pendente (despachada ou cancelada nesse meio-tempo)');
    expect(detail).toContain('(RC-260926-B0002 · 250 m) e nenhuma exceção foi registrada');
    expect(detail).not.toContain('a exceção ficou registrada');
  });

  it('recusa em português (403 = sem alçada), e a repetição depois de queda de rede reusa a MESMA chave', async () => {
    respond(403, { ok: false, error: 'Sem a permissão procurement.coverage_override.' });
    const run = runOf();
    expect(await run(BODY)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Exceção de cobertura: sem alçada', 'Sem a permissão procurement.coverage_override.');
    expect(toast.success).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('rede caiu'); }));
    expect(await run(BODY)).toBe(false);
    expect(toast.error).toHaveBeenLastCalledWith('Exceção de cobertura: sem conexão', 'O servidor não confirmou. Tente de novo — a repetição não duplica o ato.');
    respond(200, { ok: true, result: { requisition_number: 'RC-1', requisitioned_qty: 400, override: true, replayed: true } });
    expect(await run(BODY)).toBe(true);
    expect(calls[1].body.idempotencyKey).toBe(calls[0].body.idempotencyKey);
    expect(toast.success).toHaveBeenCalledWith('Compra requisitada com exceção de cobertura', 'Já estava registrado (RC-1 · 400 m) — nada foi duplicado.');
  });
});
