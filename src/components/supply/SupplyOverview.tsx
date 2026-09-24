'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Radar, ShieldCheck } from 'lucide-react';
import type { SupplyControlTowerModel } from '@/lib/supply/control-tower';
import { SUPPLY_RISK_LABEL, type SupplyRisk } from '@/lib/supply/coverage';
import {
  ApexFindingsView, AttentionRow, apexDeepLink, AxPage, Chain, Chip, CommandHeader, CoverageBar, CoverageLegend, Dot, EmptyState, Filters,
  Meter, Plane, Resource, SignalPanel, SignalStrip, apexActionable, apexFor, date, dateShort, href, money, pct, plural, qty,
  useApexSignals, useResource, useUrlParam, type ApexSignal, type ChainNode, type Tone,
} from '@/components/ax';

type Payload = SupplyControlTowerModel & { ok: true };
type Kind = 'all' | 'inbound' | 'shortage' | 'approval' | 'inspection' | 'stock';
const KIND_LABEL: Record<Exclude<Kind, 'all'>, string> = {
  inbound: 'Entrada', shortage: 'Falta', approval: 'Aprovação', inspection: 'Inspeção', stock: 'Sem comprar',
};
const RISK_TONE: Record<SupplyRisk, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'success' };
const TONE_RANK: Record<string, number> = { danger: 0, warning: 1, info: 2, accent: 3, neutral: 4, success: 5 };

interface TowerItem {
  id: string; kind: Exclude<Kind, 'all'>; tone: Tone; where: string | null; object: ReactNode; issue: ReactNode;
  detail?: ReactNode; due: string | null; href: string; actionLabel: string;
  apexRef?: { requirementId?: string | null; purchaseOrderId?: string | null; kinds: string[] };
}

/**
 * SUPPLY — TORRE DE CONTROLE. A primeira pergunta é "o que precisa de atenção
 * agora?": entradas que chegam depois da necessidade, faltas sem fonte,
 * aprovações que seguram obra, quarentena parada e o que se cobre sem comprar.
 * Cada linha traz a cadeia que a explica e, quando a Apex tem uma
 * recomendação sobre o mesmo pedido ou requisito, ela aparece ali — ao lado
 * da evidência, com o ato governado a um clique.
 */
export function SupplyOverview() {
  const resource = useResource<Payload>('/api/supply/overview');
  return (
    <AxPage testId="supply-overview">
      <Resource {...resource}>{(data) => <Tower data={data} />}</Resource>
    </AxPage>
  );
}

function Tower({ data }: { data: Payload }) {
  const apex = useApexSignals();
  const [kind, setKind] = useUrlParam<Kind>('filter', 'all');
  const [focus] = useUrlParam<string>('focus', '');
  const [expanded, setExpanded] = useState(false);
  const [panel, setPanel] = useState<{ mode: 'execute' | 'follow'; signal: ApexSignal } | null>(null);
  const k = data.kpis; const s = data.signals;

  const items = useMemo(() => buildItems(data), [data]);
  const counts = useMemo(() => items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {}), [items]);
  const filtered = kind === 'all' ? items : items.filter((i) => i.kind === kind);
  const shown = expanded ? filtered : filtered.slice(0, 8);
  const urgent = items.filter((i) => i.tone === 'danger').length;

  return (
    <>
      <CommandHeader domain="supply" area="Visão geral" title="Torre de controle"
        context={<>
          <span><strong>{items.length}</strong> {items.length === 1 ? 'ponto pede' : 'pontos pedem'} atenção</span>
          {urgent > 0 && <span><Dot tone="danger" label="urgente" /><strong>{urgent}</strong> {urgent === 1 ? 'urgente' : 'urgentes'}</span>}
          <span>{plural(k.projectsExposed, 'projeto exposto', 'projetos expostos')}</span>
          <span>Hoje, {date(data.today)}</span>
        </>}
        actions={<>
          <Link className="ax-btn" href={href.materialPlanning('short')}>Planejamento de materiais</Link>
          <Link className="ax-btn primary" href="/supply/compras">Compras<ArrowUpRight size={14} aria-hidden /></Link>
        </>} />

      <SignalStrip label="Sinais do Supply" items={[
        { label: 'Faltas críticas', value: k.criticalShortages, hint: 'a 7 dias da necessidade, ou vencidas',
          tone: k.criticalShortages ? 'danger' : undefined, href: href.materialPlanning('critical') },
        { label: 'Sem cobertura', value: k.uncovered, hint: `de ${plural(k.demandLines, 'linha', 'linhas')} de demanda`,
          tone: k.uncovered ? 'warning' : undefined, href: href.materialPlanning('short') },
        { label: 'Entradas em risco', value: s.inboundAtRisk,
          hint: s.inboundAtRisk ? [s.inboundAfterNeed ? `${s.inboundAfterNeed} depois da necessidade` : null,
            s.inboundLate ? plural(s.inboundLate, 'atrasada', 'atrasadas') : null].filter(Boolean).join(' · ') || 'folga curta até a necessidade'
            : 'tudo chega a tempo',
          tone: s.inboundAfterNeed ? 'danger' : s.inboundAtRisk ? 'warning' : undefined, onClick: () => setKind('inbound') },
        { label: 'Aprovações', value: s.approvalsPending, hint: 'pedidos esperando alçada',
          tone: s.approvalsPending ? 'warning' : undefined, href: '/supply/compras?stage=aprovacao' },
        { label: 'Em inspeção', value: s.inspectionPending,
          hint: s.inspectionPending ? (s.oldestInspectionDays ? `a mais antiga há ${s.oldestInspectionDays} dias` : 'recebido hoje') : 'quarentena em dia',
          tone: s.oldestInspectionDays > 2 ? 'warning' : undefined, href: '/supply/recebimentos?queue=inspection' },
        { label: 'Em pedido aberto', value: money(data.flow.openPoValue, 'BRL', { compact: true }), hint: 'saldo a receber dos emitidos',
          href: '/supply/compras?stage=pedidos' },
      ]} />

      <div className="ax-grid main-side">
        <Plane title="O que precisa de atenção agora" count={items.length} countTone={urgent ? 'danger' : undefined} flush testId="supply-attention"
          subtitle="Cada linha com a cadeia que a explica — fornecedor, pedido, material, requisito, atividade e projeto"
          bar={<Filters label="Filtrar por tipo" value={kind} onChange={(v) => { setKind(v); setExpanded(false); }} options={[
            { id: 'all', label: 'Tudo', count: items.length },
            ...(Object.keys(KIND_LABEL) as Array<Exclude<Kind, 'all'>>).filter((x) => counts[x])
              .map((x) => ({ id: x, label: KIND_LABEL[x], count: counts[x] })),
          ]} />}>
          {filtered.length === 0 ? (
            <EmptyState title="Nada pedindo atenção" icon={<ShieldCheck size={18} />}>
              Toda demanda confirmada está coberta ou entrando a tempo, nenhuma compra espera alçada e a quarentena está em dia.
            </EmptyState>
          ) : (
            <div className="ax-queue">
              {shown.map((i) => {
                const signal = i.apexRef ? apexFor(apex.data, i.apexRef) : null;
                return (
                  <AttentionRow key={i.id} tone={i.tone} kind={KIND_LABEL[i.kind]} impact={i.where} object={i.object} issue={i.issue}
                    detail={i.detail || signal ? <>{i.detail}{signal && <ApexInline signal={signal} caps={apex.data?.capabilities} onOpen={setPanel} />}</> : undefined}
                    due={i.due} today={data.today} href={i.href} actionLabel={i.actionLabel} hideOwner testId={`tower-${i.kind}`} />
                );
              })}
              {filtered.length > shown.length && (
                <button type="button" className="ax-btn ghost" style={{ margin: 10 }} onClick={() => setExpanded(true)}>
                  Ver mais {filtered.length - shown.length}
                </button>
              )}
            </div>
          )}
        </Plane>

        <div className="ax-stack">
          <ApexFindingsView source={apex} limit={focus === 'apex' ? undefined : 4} title="Apex — recomendações" testId="apex-findings" />

          <Plane title="Projetos em risco de supply" subtitle="O pior requisito decide o projeto" flush>
            {data.projectRisks.length === 0 ? <EmptyState compact title="Nenhum projeto exposto">Toda demanda confirmada está coberta ou entrando.</EmptyState> : (
              <ul className="ax-queue" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.projectRisks.slice(0, 6).map((p) => (
                  <li key={p.projectId} className="ax-row" data-tone={RISK_TONE[p.worst]} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                    <div className="ax-row-main">
                      <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={href.project(p.projectId, 'supply')}>{p.project}</Link>
                      <span className="ax-row-issue">
                        {plural(p.shortages, 'material com falta', 'materiais com falta')}{p.nextNeed ? ` · próxima necessidade ${dateShort(p.nextNeed)}` : ''}
                      </span>
                    </div>
                    <Chip tone={RISK_TONE[p.worst]}>{SUPPLY_RISK_LABEL[p.worst]}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Plane>

          <Plane title="Fornecedores sob observação" subtitle="Pontualidade medida nos recebimentos — nunca estimada" flush>
            {data.supplierRisk.length === 0 ? <EmptyState compact title="Nenhum fornecedor em risco">Nenhuma entrada atrasada ou depois da necessidade.</EmptyState> : (
              <ul className="ax-queue" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.supplierRisk.slice(0, 5).map((f) => (
                  <li key={f.id} className="ax-row" data-tone={f.lateLines ? 'danger' : 'warning'} style={{ gridTemplateColumns: 'minmax(0,1fr) 108px' }}>
                    <div className="ax-row-main">
                      <Link className="ax-row-object ax-link" style={{ color: 'var(--ax-fg-strong)' }} href={href.supplier(f.id)}>{f.name}</Link>
                      <span className="ax-row-issue">
                        {[f.chains ? plural(f.chains, 'entrada em risco', 'entradas em risco') : null,
                          f.lateLines ? plural(f.lateLines, 'atrasada', 'atrasadas') : null,
                          plural(f.openOrders, 'pedido aberto', 'pedidos abertos')].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="ax-cellstack" style={{ alignItems: 'stretch' }}>
                      {f.onTimeRate === null ? <small>sem histórico de entrega</small> : (
                        <>
                          <small>{pct(f.onTimeRate)} no prazo · {plural(f.deliveryLines, 'linha', 'linhas')}</small>
                          <Meter value={f.onTimeRate} tone={f.onTimeRate < 0.7 ? 'danger' : f.onTimeRate < 0.85 ? 'warning' : 'success'}
                            label={`${f.name}: ${pct(f.onTimeRate)} das linhas no prazo`} />
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Plane>
        </div>
      </div>

      <Plane title="Cobertura da demanda em falta" subtitle="Requerido × o que já cobre — a parte hachurada é o que ainda não tem fonte" flush
        action={<span className="ax-desktop-only"><CoverageLegend /></span>}>
        {data.criticalShortages.length === 0 ? (
          <EmptyState compact title="Nenhuma falta de material" icon={<ShieldCheck size={18} />}>Toda demanda confirmada está coberta ou entrando.</EmptyState>
        ) : (
          <div className="ax-table-wrap">
            <table className="ax-table cards">
              <caption className="sr-only-ax">Faltas de material por necessidade</caption>
              <thead><tr><th>Material</th><th>Projeto · atividade</th><th>Necessidade</th><th style={{ width: '32%' }}>Cobertura</th><th className="num">Risco</th><th /></tr></thead>
              <tbody>
                {data.criticalShortages.slice(0, 12).map((d) => (
                  <tr key={d.requirementId}>
                    <td><div className="ax-cellstack"><span className="strong">{d.itemDescription ?? d.title}</span><small>{d.itemCode ?? d.title}</small></div></td>
                    <td><div className="ax-cellstack"><span>{d.project}</span><small>{d.activity ?? 'sem atividade vinculada'}</small></div></td>
                    <td><div className="ax-cellstack"><span className="ax-num">{dateShort(d.needBy)}</span>
                      <small>{d.daysToNeed === null ? 'sem data' : d.daysToNeed < 0 ? `vencida há ${-d.daysToNeed} d` : `em ${d.daysToNeed} d`}</small></div></td>
                    <td><CoverageBar unit={d.unit} parts={{ required: d.coverage.required, consumed: d.coverage.consumed, reserved: d.coverage.reserved,
                      transit: d.coverage.inTransit, inspection: d.coverage.inspection, onOrder: d.coverage.onOrder, shortage: d.coverage.shortage }} /></td>
                    <td className="num"><Chip tone={RISK_TONE[d.risk]}>{SUPPLY_RISK_LABEL[d.risk]}</Chip></td>
                    <td className="num"><Link className="ax-btn sm" href={href.requirement(d.requirementId)}>Cobrir<ArrowUpRight size={13} aria-hidden /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Plane>

      <p className="ax-note"><ShieldCheck size={13} aria-hidden />
        Demanda é o requisito de material confirmado no Planejamento; cobertura, falta, atraso e risco são derivados de reservas,
        transferências, pedidos, embarques e recebimentos. A Apex recomenda — quem executa é você, pelo ato governado.</p>

      {panel && <SignalPanel mode={panel.mode} signal={panel.signal} onClose={() => setPanel(null)}
        onDone={() => { setPanel(null); apex.refresh(); }} />}
    </>
  );
}

/** A recomendação da Apex sobre o mesmo pedido/requisito, dentro da linha. */
function ApexInline({ signal, caps, onOpen }: {
  signal: ApexSignal; caps?: Parameters<typeof apexActionable>[1]; onOpen: (p: { mode: 'execute' | 'follow'; signal: ApexSignal }) => void;
}) {
  const canExecute = apexActionable(signal, caps);
  const canFollow = !canExecute && Boolean(caps?.FOLLOW_UP) && !signal.followupId && signal.action.kind === 'FOLLOW_UP';
  return (
    <span className="ax-apex-inline" data-testid="apex-inline">
      <Radar size={13} aria-hidden />
      <span>Apex recomenda: <b>{signal.action.label}</b></span>
      {canExecute && <button type="button" className="ax-btn primary sm" onClick={() => onOpen({ mode: 'execute', signal })}>Executar</button>}
      {signal.action.kind === 'OPEN' && <Link className="ax-btn sm" href={apexDeepLink(signal)}>Abrir</Link>}
      {canFollow && <button type="button" className="ax-btn sm" onClick={() => onOpen({ mode: 'follow', signal })}>Acompanhar</button>}
      {signal.followupId && <span className="ax-subtle">em acompanhamento</span>}
    </span>
  );
}

function buildItems(data: Payload): TowerItem[] {
  const out: TowerItem[] = [];
  for (const c of data.inbound) {
    const after = c.slackDays !== null && c.slackDays < 0;
    const nodes: ChainNode[] = [
      { label: c.supplier, href: href.supplier(c.supplierId) },
      { label: c.poNumber, href: href.purchaseOrder(c.poId) },
      { label: c.itemCode },
      ...(c.requirementId ? [{ label: c.requirement ?? 'Requisito', href: href.requirement(c.requirementId) }] : []),
      ...(c.activity ? [{ label: c.activity }] : []),
      ...(c.projectId ? [{ label: c.project ?? 'Projeto', href: href.project(c.projectId, 'supply'), end: after }] : []),
    ];
    out.push({
      id: `in:${c.poId}:${c.requirementId ?? c.itemCode}`, kind: 'inbound',
      tone: c.risk === 'critical' ? 'danger' : c.risk === 'high' ? 'warning' : 'info',
      where: c.project ?? 'Reposição de estoque', object: <>{c.itemDescription} <span className="ax-subtle">· {qty(c.openQty, c.unit)}</span></>,
      issue: after ? `Chega ${plural(-(c.slackDays ?? 0), 'dia', 'dias')} depois da necessidade (${dateShort(c.eta)}, promessa ${c.etaSource === 'embarque' ? 'do embarque' : c.etaSource === 'linha' ? 'da linha' : 'do pedido'})`
        : c.late ? `Atrasado ${plural(c.daysLate, 'dia', 'dias')} — prometido para ${dateShort(c.eta)}`
          : `Folga de ${plural(c.slackDays ?? 0, 'dia', 'dias')} até a necessidade`,
      detail: <Chain nodes={nodes} label="Cadeia do pedido até o projeto" />,
      due: c.needBy ?? c.eta, href: href.purchaseOrder(c.poId), actionLabel: 'Abrir pedido',
      apexRef: { purchaseOrderId: c.poId, requirementId: c.requirementId, kinds: ['ETA_RISK', 'LATE_INBOUND', 'SUPPLIER_RELIABILITY'] },
    });
  }
  for (const d of data.criticalShortages.filter((x) => x.risk === 'critical' || x.risk === 'high')) {
    out.push({
      id: `short:${d.requirementId}`, kind: 'shortage', tone: RISK_TONE[d.risk], where: d.project,
      object: d.itemDescription ?? d.title,
      issue: `Falta ${qty(d.coverage.shortage, d.unit)} — ${d.coverage.inbound > 0 ? 'o que está entrando não cobre' : 'sem estoque, transferência ou pedido'}`,
      detail: <Chain label="Da necessidade ao projeto" nodes={[
        { label: d.title, href: href.requirement(d.requirementId) },
        ...(d.activity ? [{ label: d.activity }] : []),
        { label: d.project, href: href.project(d.projectId, 'supply'), end: d.risk === 'critical' },
      ]} />,
      due: d.needBy, href: href.requirement(d.requirementId), actionLabel: 'Cobrir falta',
      apexRef: { requirementId: d.requirementId, kinds: ['SHORTAGE', 'ALTERNATE_STOCK', 'DECISION_PENDING', 'DECISION_STALLED'] },
    });
  }
  for (const a of data.approvals) {
    out.push({
      id: `ap:${a.id}`, kind: 'approval',
      tone: a.daysToNeed !== null && a.daysToNeed <= 7 ? 'danger' : a.daysToNeed !== null && a.daysToNeed <= 14 ? 'warning' : 'accent',
      where: a.projects.join(' · ') || null, object: <>Pedido {a.number} <span className="ax-subtle">· {money(a.total, a.currency)}</span></>,
      issue: `Aguarda alçada ${a.waitingDays ? `há ${plural(a.waitingDays, 'dia', 'dias')}` : 'desde hoje'} — sem aprovação, não é emitido nem conta como entrada`,
      detail: <span className="ax-subtle" style={{ fontSize: 12 }}>{a.supplier} · {a.items.join(', ')}</span>,
      due: a.needBy, href: href.approval(a.id), actionLabel: 'Decidir', apexRef: { purchaseOrderId: a.id, kinds: ['DECISION_PENDING', 'DECISION_STALLED'] },
    });
  }
  for (const r of data.inspection) {
    out.push({
      id: `insp:${r.id}`, kind: 'inspection', tone: r.ageDays > 2 ? 'warning' : 'accent', where: r.location,
      object: <>Recebimento {r.number} <span className="ax-subtle">· {qty(r.quantity)}</span></>,
      issue: `Em quarentena ${r.ageDays ? `há ${plural(r.ageDays, 'dia', 'dias')}` : 'desde hoje'} — não reservável até a inspeção`,
      detail: <span className="ax-subtle" style={{ fontSize: 12 }}>{r.supplier} · pedido {r.poNumber}</span>,
      due: null, href: href.receipt(r.id, 'inspection'), actionLabel: 'Inspecionar', apexRef: { purchaseOrderId: r.poId, kinds: ['INSPECTION_BACKLOG'] },
    });
  }
  for (const c of data.stockCover) {
    out.push({
      id: `stock:${c.requirementId}`, kind: 'stock', tone: 'accent', where: c.project, object: c.itemDescription,
      issue: c.strategy === 'TRANSFER'
        ? `Transferir ${qty(c.quantity, c.unit)} de ${c.fromLocation ?? 'outro local'}${c.toSite ? ` para ${c.toSite}` : ''} — cobre ${c.quantity >= c.shortage ? 'a falta' : 'parte da falta'} sem comprar`
        : `Reservar ${qty(c.quantity, c.unit)} do estoque livre em ${c.fromLocation ?? 'local do projeto'} — cobre sem comprar`,
      due: c.needBy, href: href.requirement(c.requirementId), actionLabel: 'Planejar', apexRef: { requirementId: c.requirementId, kinds: ['ALTERNATE_STOCK'] },
    });
  }
  return out.sort((a, b) => (TONE_RANK[a.tone] ?? 9) - (TONE_RANK[b.tone] ?? 9) || (a.due ?? '9999').localeCompare(b.due ?? '9999'));
}
