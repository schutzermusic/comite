/**
 * OS interna em Operações (230):
 *  • a próxima ação segue a ordem dos portões do banco (revisão → bloqueio → emissão → projeto);
 *  • a exceção só aparece com bloqueio E conteúdo revisado;
 *  • confronto assistido: candidata sem os dois lados, fora de escopo ou com
 *    confiança baixa não entra na fila; duplicata também não;
 *  • identidade de projeto lê as duas gerações do cadastro;
 *  • o menu de Operações acende em /operacoes e em /projetos.
 */
import { describe, expect, it } from 'vitest';
import {
  canIssueNormally, canIssueWithException, serviceOrderNextAction,
} from '@/lib/operations/service-orders/next-action';
import {
  DIVERGENCE_REVIEW_SCHEMA, MIN_CANDIDATE_CONFIDENCE, buildDivergenceReviewPrompt, normalizeDivergenceCandidates,
} from '@/lib/operations/service-orders/divergence-review';
import { projectIdentity, isActiveProjectStatus } from '@/lib/operations/project-identity';
import { OPERATIONS_NAV, isOperationsRoute } from '@/lib/operations/navigation';
import { ITEM_SECTIONS, itemKindLabels } from '@/lib/operations/service-orders/labels';
import { safeOperationsError } from '@/lib/operations/session';
import { findSchemaUnions } from '@/lib/ai/gateway/schema-complexity';

const counts = (over: Partial<{ items: number; unreviewedItems: number; openDivergences: number; blockingOpen: number }> = {}) =>
  ({ items: 3, unreviewedItems: 0, openDivergences: 0, blockingOpen: 0, ...over });

describe('próxima ação da OS', () => {
  it('conteúdo pendente vem antes do bloqueio — é o primeiro portão do gatilho', () => {
    const a = serviceOrderNextAction('PENDING_CONFIRMATION', null, counts({ unreviewedItems: 2, blockingOpen: 1, openDivergences: 1 }));
    expect(a.code).toBe('REVIEW_CONTENT');
    expect(a.label).toBe('Revisar 2 linhas lidas');
    expect(a.needsDecision).toBe(true);
  });
  it('bloqueante em aberto pede decisão, em tom de perigo', () => {
    const a = serviceOrderNextAction('PENDING_CONFIRMATION', null, counts({ blockingOpen: 1, openDivergences: 2 }));
    expect(a).toMatchObject({ code: 'RESOLVE_BLOCKING', tone: 'danger' });
  });
  it('aviso não bloqueia, mas é conferido antes de emitir', () => {
    expect(serviceOrderNextAction('DRAFT', null, counts({ openDivergences: 1 })).code).toBe('REVIEW_WARNINGS');
  });
  it('rascunho limpo → emitir; emitida sem projeto → vincular; com projeto → em execução', () => {
    expect(serviceOrderNextAction('DRAFT', null, counts()).code).toBe('ISSUE');
    expect(serviceOrderNextAction('ISSUED', null, counts()).code).toBe('LINK_PROJECT');
    const running = serviceOrderNextAction('IN_EXECUTION', 'proj-1', counts());
    expect(running).toMatchObject({ code: 'IN_EXECUTION', needsDecision: false });
  });
  it('cancelada e encerrada não entram na fila de decisão', () => {
    expect(serviceOrderNextAction('CANCELLED', null, counts({ blockingOpen: 3 })).needsDecision).toBe(false);
    expect(serviceOrderNextAction('CLOSED', 'p', counts()).needsDecision).toBe(false);
  });
  it('emissão normal espelha o portão; exceção só com bloqueio e conteúdo revisado', () => {
    expect(canIssueNormally('DRAFT', counts())).toBe(true);
    expect(canIssueNormally('DRAFT', counts({ blockingOpen: 1 }))).toBe(false);
    expect(canIssueNormally('ISSUED', counts())).toBe(false);
    expect(canIssueWithException('PENDING_CONFIRMATION', counts({ blockingOpen: 1 }))).toBe(true);
    expect(canIssueWithException('PENDING_CONFIRMATION', counts({ blockingOpen: 1, unreviewedItems: 1 }))).toBe(false);
    expect(canIssueWithException('DRAFT', counts())).toBe(false);
  });
});

describe('confronto assistido OS × PT × PC', () => {
  const good = { scope: 'DELIVERABLE', severity: 'WARNING', summary: 'Relatório de comissionamento ausente na OS',
    left_value: 'Relatório de comissionamento (PT p.4)', right_value: '', confidence: 0.8 };

  it('aceita candidata com os dois lados, escopo permitido e confiança suficiente', () => {
    const { candidates, discarded } = normalizeDivergenceCandidates({ divergences: [good] });
    expect(discarded).toBe(0);
    expect(candidates[0]).toMatchObject({ scope: 'DELIVERABLE', severity: 'WARNING', rightValue: null });
  });
  it('descarta confiança baixa, escopo fora da lista, lado esquerdo vazio e duplicata', () => {
    const { candidates, discarded } = normalizeDivergenceCandidates({ divergences: [
      { ...good, confidence: MIN_CANDIDATE_CONFIDENCE - 0.01 },
      { ...good, scope: 'PACKAGE_REVISION' },
      { ...good, left_value: '  ' },
      good, { ...good, summary: good.summary.toUpperCase() },
    ] });
    expect(candidates).toHaveLength(1);
    expect(discarded).toBe(4);
  });
  it('resposta sem lista não inventa nada', () => {
    expect(normalizeDivergenceCandidates(null)).toEqual({ candidates: [], discarded: 0 });
    expect(normalizeDivergenceCandidates({ divergences: 'x' })).toEqual({ candidates: [], discarded: 0 });
  });
  it('o prompt carrega fonte, domínio, valor e página de cada fato', () => {
    const prompt = buildDivergenceReviewPrompt([
      { source: 'PT', domain: 'DELIVERABLE', label: 'Relatório', value: 'Relatório final', page: 4 },
      { source: 'OS', domain: 'SCOPE', label: 'Montagem', value: null, page: null },
    ]);
    expect(prompt).toContain('[PT] DELIVERABLE · Relatório = Relatório final (p.4)');
    expect(prompt).toContain('[OS] SCOPE · Montagem');
    expect(prompt).not.toContain('PACKAGE_REVISION');
  });
  it('o esquema é compatível com a saída estruturada (sem união de tipos, sem maxItems)', () => {
    expect(findSchemaUnions(DIVERGENCE_REVIEW_SCHEMA)).toEqual([]);
    expect(JSON.stringify(DIVERGENCE_REVIEW_SCHEMA)).not.toContain('maxItems');
  });
});

describe('identidade de projeto e navegação', () => {
  it('lê nome/name, código e cliente das duas gerações do cadastro', () => {
    expect(projectIdentity('p1', { nome: 'Subestação', codigo: '2774', cliente: 'Eletro' })).toMatchObject(
      { name: 'Subestação', code: '2774', client: 'Eletro' });
    expect(projectIdentity('p2', { name: 'Linha 3', status: 'em_andamento' }).name).toBe('Linha 3');
    expect(projectIdentity('p3', {}).name).toBe('p3');
    expect(isActiveProjectStatus('em_andamento')).toBe(true);
    expect(isActiveProjectStatus('concluido')).toBe(false);
    expect(isActiveProjectStatus(null)).toBe(false);
  });
  it('o grupo Operações acende em /operacoes e em /projetos, e só nelas', () => {
    expect(isOperationsRoute('/operacoes')).toBe(true);
    expect(isOperationsRoute('/operacoes/ordens-servico/abc')).toBe(true);
    expect(isOperationsRoute('/projetos/123')).toBe(true);
    expect(isOperationsRoute('/operacoesx')).toBe(false);
    expect(isOperationsRoute('/contratos')).toBe(false);
  });
  it('cada destino tem alçada própria; Projetos não exige operations.view', () => {
    const projects = OPERATIONS_NAV.find((i) => i.id === 'projects')!;
    expect(projects.anyPermission).not.toContain('operations.view');
    expect(OPERATIONS_NAV.find((i) => i.id === 'serviceOrders')!.anyPermission).toEqual(['operations.view']);
  });
  it('toda espécie de linha tem rótulo e cai em exatamente uma seção', () => {
    for (const kind of Object.keys(itemKindLabels)) {
      expect(ITEM_SECTIONS.filter((s) => s.kinds.includes(kind as never))).toHaveLength(1);
    }
  });
  it('recusa de portão chega legível; detalhe de esquema não', () => {
    expect(safeOperationsError('Service order cannot be issued: 1 blocking divergence(s) still open.'))
      .toContain('blocking divergence');
    expect(safeOperationsError('Permission required: operations.service_orders.override.'))
      .toContain('operations.service_orders.override');
    expect(safeOperationsError('duplicate key value violates unique constraint "iso_one_per_package"'))
      .not.toContain('iso_one_per_package');
  });
});
