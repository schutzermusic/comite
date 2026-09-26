/**
 * 252 · as recusas da edição de requisito com cobertura chegam em português pela MESMA cadeia das rotas
 * (`governedFailure` + `requirementCoverageErrorMessage`): reduzir abaixo do comprometido, trocar o item com
 * cobertura e cancelar / planejar / substituir com cobertura ativa. Números exatos, no formato brasileiro.
 */
import { describe, expect, it } from 'vitest';

import { governedFailure } from '@/lib/operations/session';
import { GovernedRpcError } from '@/lib/platform/governed-rpc';
import { requirementCoverageErrorMessage } from '@/lib/operations/planning/validation';
import { domainEventTitle } from '@/lib/operations/projects/timeline';

const viaRoute = async (message: string, code = '23514') => {
  const res = governedFailure(new GovernedRpcError(message, code), requirementCoverageErrorMessage);
  return { status: res.status, error: (await res.json()).error as string };
};

describe('252 · edição de requisito com cobertura — recusas em português (422)', () => {
  it('reduzir abaixo do comprometido: a quantidade, o comprometido e as parcelas', async () => {
    expect(await viaRoute('Requirement quantity 40 is below its committed coverage 50 (reserved 30, requested 20): release or cancel coverage first.'))
      .toEqual({ status: 422, error: 'A quantidade 40 fica abaixo da cobertura já comprometida (50: reservado 30, requisitado 20). '
        + 'Libere a reserva ou cancele a transferência, a solicitação ou o pedido antes de reduzir.' });
    expect((await viaRoute('Requirement quantity 59.99997 is below its committed coverage 60 (on order 60): release or cancel coverage first.')).error)
      .toMatch(/^A quantidade 59,99997 fica abaixo da cobertura já comprometida \(60: em pedido 60\)/);
    expect((await viaRoute('Requirement quantity empty is below its committed coverage 30 (consumed 30): release or cancel coverage first.')).error)
      .toMatch(/^A quantidade vazia fica abaixo da cobertura já comprometida \(30: consumido 30\)/);
  });

  it('trocar o item com cobertura', async () => {
    expect((await viaRoute('Requirement has coverage of its current item (100 committed: pending transfers 20, in transit 30, in inspection 50): the item changes only after that coverage is released or cancelled.')).error)
      .toBe('O requisito tem cobertura do item atual (100: transferências pendentes 20, em trânsito 30, em inspeção 50). '
        + 'O item só muda depois de liberar ou cancelar essa cobertura — ou substitua o requisito por um novo.');
  });

  it('cancelar, planejar ou substituir com cobertura ativa', async () => {
    const msg = (to: string) => `Requirement has active coverage 100 (reserved 30, pending transfers 20, requested 50): release or cancel it before moving the requirement to ${to}.`;
    expect((await viaRoute(msg('CANCELLED'))).error).toBe('O requisito tem cobertura ativa (100: reservado 30, transferências pendentes 20, requisitado 50). '
      + 'Libere a reserva ou cancele a transferência, a solicitação ou o pedido antes de cancelar o requisito.');
    expect((await viaRoute(msg('PLANNED'))).error).toMatch(/antes de devolvê-lo ao planejamento\.$/);
    expect((await viaRoute(msg('SUPERSEDED'))).error).toMatch(/antes de substituí-lo\.$/);
  });

  it('as outras recusas do requisito seguem como antes (o tradutor não as engole)', () => {
    expect(requirementCoverageErrorMessage('Requirement cancellation requires a written reason.')).toBeNull();
    expect(requirementCoverageErrorMessage('Requirement is CANCELLED: history is not edited.')).toBeNull();
  });

  it('a linha do tempo tem título para a data alterada', () => {
    expect(domainEventTitle('operations.requirement.rescheduled')).toMatchObject({ title: 'Data do requisito alterada', kind: 'schedule' });
  });
});
