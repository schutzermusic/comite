'use client';

import Link from 'next/link';
import { ArrowUpRight, CalendarClock, CalendarRange, ClipboardList, FileText, Package, Radar, RefreshCw, ShieldCheck } from 'lucide-react';
import type { MaterialBalance, NeedOrigin, SiteSupplyData } from '@/lib/dashboard/types';
import type { ModuleProps } from '../../contract';
import {
  balanceRows, coverageSegments, dayMonth, flowReadable, locatedStock, networkSummary, pendingForViewer, qtyText, remainingToBuy, requisitionGate,
  type SupplyStage,
} from '../model';
import { StateNote } from '../shared';
import { Signal, Spin, StepEyebrow } from './ui';

/**
 * ETAPA 1 — NECESSIDADE (painel da esquerda): o material em foco com a
 * ORIGEM da necessidade dita como é (cronograma / OS / registro manual — "Apex
 * leu a OS" só quando o item da OS foi lido pela Apex), o balanço da cobertura
 * VIVA, a barra de cobertura e o botão do filme: "Analisar a rede de estoque".
 * Depois da varredura, o que a rede respondeu (o livro-razão da cena 3).
 */
export function NeedPanel({ data, today, stage, onScan, onDirect, onExplain }: {
  data: SiteSupplyData; today: string; stage: SupplyStage;
  onScan: () => void; onDirect: () => void; onExplain: ModuleProps['onExplain'];
}) {
  const m = data.focus;
  if (!m) {
    return (
      <>
        <StepEyebrow n={1} icon={<Package size={16} />}>Necessidade</StepEyebrow>
        {data.materials.length === 0
          ? <StateNote kind="empty" title="Nenhuma falta de material neste projeto">A cobertura viva não mostra requisito com falta{data.truncated ? ' na parte lida' : ''}.</StateNote>
          : <StateNote kind="empty" title="Nenhum material em falta">{`${data.materials.length.toLocaleString('pt-BR')} ${data.materials.length === 1 ? 'material acompanhado' : 'materiais acompanhados'} pela cobertura viva.`}</StateNote>}
      </>
    );
  }
  const others = data.materials.filter((x) => x.requirementId !== m.requirementId && x.shortage > 0).length;
  const pending = stage === 'idle' ? pendingForViewer(data) : null;
  return (
    <>
      <StepEyebrow n={1} icon={<Package size={16} />}>{m.activity ? `Necessidade · ${m.activity.title}` : 'Necessidade'}</StepEyebrow>
      <h3 className="dgm-title">{m.title}</h3>
      <p className="dgm-sub">{specLine(m)}</p>
      <OriginLine origin={m.origin} />
      {m.needBy && (
        <p className="dgm-need-by"><CalendarClock size={16} aria-hidden />Necessário até <b className="num">{dayMonth(m.needBy)}</b>
          {m.needBy < today && <small className="dgm-late"> · data já passou</small>}
        </p>
      )}
      {/* Quem veio decidir/aprovar vê o atalho ANTES do balanço (à vista sem rolar); o botão do filme segue logo abaixo. */}
      {pending && (
        <div className="dgs-callout" data-testid="dg-supply-pending">
          <ShieldCheck size={17} aria-hidden />
          <div>
            <b>{pending}</b>
            <button type="button" className="dgm-textbtn" onClick={onDirect}>Ir direto à comparação e à decisão</button>
          </div>
        </div>
      )}
      <dl className="dgm-eq dgs-eq" data-testid="dg-supply-balance" data-compact={pending ? 'true' : undefined}>
        {balanceRows(m).map((r) => (
          <div key={r.key} data-tone={r.tone} title={r.hint}>
            <dt>{r.label}</dt>
            <dd className="num">{r.text}</dd>
          </div>
        ))}
      </dl>
      <CoverageBar m={m} />

      <ScanControl data={data} stage={stage} onScan={onScan} onDirect={onDirect} />
      {(stage === 'revealed' || stage === 'direct') && <NetworkLedger data={data} />}

      <div className="dgm-actions">
        <button type="button" className="dgm-textbtn" onClick={() => onExplain(`mat:${m.requirementId}`)}>Entender a falta</button>
        <Link className="dgm-textbtn" href={m.href}>Abrir no Supply<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
      {(others > 0 || data.truncated) && (
        <p className="dgm-foot">
          {others > 0 ? `Mais ${others.toLocaleString('pt-BR')} ${others === 1 ? 'material com falta' : 'materiais com falta'} neste projeto.` : ''}
          {data.truncated ? ' Leitura parcial: há mais requisitos do que os mostrados.' : ''}
        </p>
      )}
    </>
  );
}

function specLine(m: MaterialBalance): string {
  const parts = [m.item?.code, m.item?.description].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Item sem cadastro no Supply';
}

const ORIGIN_ICON: Record<NeedOrigin['source'], typeof FileText> = {
  ACTIVITY: CalendarRange, SERVICE_ORDER: FileText, AI_PROPOSAL: FileText, MANUAL: ClipboardList, OTHER: ClipboardList,
};

/** De onde veio a necessidade — o texto do servidor, com a OS como link; "Apex leu a OS" só quando é verdade. */
function OriginLine({ origin }: { origin: NeedOrigin | null }) {
  if (!origin) {
    return <p className="dgs-origin" data-source="unknown"><span className="dgs-origin-ico" aria-hidden><ClipboardList size={15} /></span><span>Origem da necessidade não pôde ser lida.</span></p>;
  }
  const Icon = ORIGIN_ICON[origin.source] ?? ClipboardList;
  return (
    <div className="dgs-origin" data-source={origin.source} data-testid="dg-supply-origin">
      <span className="dgs-origin-ico" aria-hidden><Icon size={15} /></span>
      <div>
        <span className="dgs-origin-label">{origin.label}</span>
        {(origin.serviceOrder || origin.readByAi) && (
          <span className="dgs-origin-meta">
            {origin.readByAi && <Signal tone="accent" label="Apex leu a OS" />}
            {origin.serviceOrder && (
              <Link className="dgm-textbtn" href={origin.serviceOrder.href}>Abrir a OS {origin.serviceOrder.number}<ArrowUpRight size={13} aria-hidden /></Link>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function CoverageBar({ m }: { m: MaterialBalance }) {
  const segs = coverageSegments(m);
  if (segs.length === 0) return null;
  return (
    <div className="dgm-lots dgs-lots" role="img" aria-label={`Cobertura: ${segs.map((s) => s.text).join(', ')}`}>
      {segs.map((s) => <span key={s.key} data-k={s.key} style={{ flexGrow: s.qty }} title={s.text}>{s.text}</span>)}
    </div>
  );
}

/**
 * O botão do filme e o estado da varredura. Sem leitura de estoque, não há
 * rede a varrer: o plano abre direto — se houver o que ver. Com o plano, as
 * compras e os fornecedores todos Restritos, o botão levaria a uma pilha de
 * cadeados: não é oferecido, e a tela diz por quê.
 */
function ScanControl({ data, stage, onScan, onDirect }: { data: SiteSupplyData; stage: SupplyStage; onScan: () => void; onDirect: () => void }) {
  if (data.stock.state === 'restricted') {
    const readable = flowReadable(data);
    return (
      <div className="dgs-scan">
        <StateNote kind="restricted" title="Restrito">
          {readable ? 'Seu perfil não lê as posições de estoque: não há rede a varrer.'
            : 'Seu perfil não lê as posições de estoque, o plano de cobertura nem as compras deste material.'}
        </StateNote>
        {stage === 'idle' && readable && <button type="button" className="dgm-btn dgm-btn-wide" onClick={onDirect}><Radar size={17} aria-hidden />Ver o plano do Apex</button>}
      </div>
    );
  }
  if (data.stock.state === 'error') {
    return (
      <div className="dgs-scan">
        <StateNote kind="error" title="A rede de estoque não carregou">{data.stock.message}</StateNote>
        {stage === 'idle' && <button type="button" className="dgm-btn dgm-btn-wide" onClick={onScan}><RefreshCw size={16} aria-hidden />Tentar a análise de novo</button>}
      </div>
    );
  }
  const places = locatedStock(data).length;
  if (stage === 'scanning') {
    return (
      <div className="dgs-scan" data-stage="scanning">
        <button type="button" className="dgm-btn dgm-btn-wide dgs-scan-btn" disabled aria-busy="true" data-testid="dg-supply-scan">
          <Spin />Apex analisando a rede…
        </button>
        <p className="dgs-scan-live" role="status">
          <Signal tone="live" label="Consultando" value={places > 0 ? `${places} ${places === 1 ? 'local' : 'locais'}` : 'o canteiro'} />
        </p>
      </div>
    );
  }
  if (stage === 'idle') {
    return (
      <div className="dgs-scan" data-stage="idle">
        <button type="button" className="dgm-btn dgm-btn-wide dgs-scan-btn" onClick={onScan} data-testid="dg-supply-scan">
          <Radar size={18} strokeWidth={2.2} aria-hidden />Analisar a rede de estoque
        </button>
        <p className="dgs-scan-hint">A Apex consulta o saldo deste item em {places > 0 ? `${places} ${places === 1 ? 'local' : 'locais'} da rede` : 'toda a rede'} e monta o plano: reservar, transferir, comprar.</p>
      </div>
    );
  }
  return (
    <div className="dgs-scan" data-stage={stage}>
      <button type="button" className="dgm-link dgm-link-quiet dgm-link-sm" onClick={onScan} data-testid="dg-supply-scan">
        <RefreshCw size={14} aria-hidden />Analisar a rede de novo
      </button>
    </div>
  );
}

/** O que a rede respondeu: onde há saldo (+ quanto), quantos locais sem saldo e o que sobra para comprar. */
function NetworkLedger({ data }: { data: SiteSupplyData }) {
  const net = networkSummary(data);
  if (net.state !== 'ok') return null;
  const unit = data.focus?.item?.unit ?? null;
  // "Depois da rede" é a conta do PLANO; sem plano lido, a linha não aparece (nunca uma conta inventada).
  const left = data.plan.state === 'ok' ? remainingToBuy(data) : null;
  const gate = requisitionGate(data);
  return (
    <div className="dgs-ledger" data-testid="dg-supply-network" aria-label="O que a rede de estoque respondeu">
      <div className="dgs-ledger-h">
        <span>Rede de estoque</span>
        <Signal tone={net.hits.length > 0 ? 'success' : 'neutral'} label={net.hits.length > 0 ? `${net.hits.length} com saldo` : 'Sem saldo na rede'} />
      </div>
      {net.hits.map((h) => (
        <div key={h.id} className="dgs-ledger-row" data-tone="ok"><span>{h.name}</span><b className="num">{h.text}</b></div>
      ))}
      {net.empty > 0 && (
        <div className="dgs-ledger-row" data-tone="muted"><span>{`${net.empty} ${net.empty === 1 ? 'local' : 'locais'} sem saldo disponível`}</span></div>
      )}
      {net.unlocated > 0 && (
        <div className="dgs-ledger-row" data-tone="muted"><span>{`${net.unlocated} ${net.unlocated === 1 ? 'local' : 'locais'} sem coordenada (fora do mapa)`}</span></div>
      )}
      {left !== null && (left <= 0 && gate.overlap > 0 ? (
        // Depois da exceção de cobertura, a parte sobreposta JÁ foi comprada: despachá-la traria o material em dobro.
        <div className="dgs-ledger-row" data-tone="warn" data-testid="dg-supply-network-overlap">
          <span>{`Nada a comprar: ${gate.overlap >= gate.pending ? 'a transferência pedida' : 'parte da transferência pedida'} já foi comprada por exceção`}</span>
          <b className="num">{`${qtyText(gate.overlap, unit) ?? '—'} em dobro se despachada`}</b>
        </div>
      ) : left <= 0 && gate.pending > 0 ? (
        // Transferência pedida e sem despacho não é cobertura (regra 246): "a rede cobre" só depois do despacho.
        <div className="dgs-ledger-row" data-tone="muted" data-testid="dg-supply-network-pending">
          <span>Nada a comprar se a transferência pedida for despachada</span>
          <b className="num">{`${qtyText(gate.pending, unit) ?? '—'} sem despacho`}</b>
        </div>
      ) : (
        <div className="dgs-ledger-row" data-tone={left > 0 ? 'danger' : 'good'}>
          <span>{left > 0 ? 'A comprar depois da rede' : 'A rede cobre a falta'}</span>
          <b className="num">{left > 0 ? qtyText(left, unit) : `${qtyText(0, unit)} a comprar`}</b>
        </div>
      ))}
    </div>
  );
}
