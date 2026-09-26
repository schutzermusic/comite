'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronRight, Lock, MapPin, MapPinOff, Radar, ShieldCheck, TriangleAlert } from 'lucide-react';
import { HudSignal } from '@/components/hud';
import type { SectionState, SiteHud, SiteHudResponse, SiteMarker, SitePosition } from '@/lib/dashboard/types';
import type { ModuleId } from '../contract';
import { Failed, Restricted, SkeletonLines, filmDate, nf, severityTone, sourceLong } from './common';

type Fail = Extract<SiteHudResponse, { ok: false }>;

const PENDING_LABEL: Record<'UNRESOLVED' | 'REQUIRES_ATTENTION' | 'CONFLICT', string> = {
  UNRESOLVED: 'localização ainda não apurada',
  REQUIRES_ATTENTION: 'localização pede revisão',
  CONFLICT: 'localização em conflito entre fontes',
};

/**
 * PROJETO EM FOCO (`.ap-proj` do protótipo) — o local, com dado real:
 * eyebrow com a UF, nome, cliente, chips (OS, código, local + fonte), ESCOPO
 * só quando cadastrado, 2×2 (fase atual com a barra REAL, próximo marco,
 * equipe — "Restrito" quando não lê —, contrato — valor só com a leitura
 * financeira), o cartão da linha mais grave com a próxima ação e "Ver plano
 * do Apex ›" (Supply quando há falta; senão o cronograma).
 */
export function SitePanel({ state, marker, onNavigate, onRetry, onBack }: {
  state: { status: 'idle' | 'loading' | 'ready' | 'failed'; data: SiteHudResponse | null; message: string | null };
  /** O marcador do overview (nome e posição antes do HUD chegar). */
  marker: SiteMarker | null;
  onNavigate: (m: ModuleId) => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const data = state.data;
  if (!data) {
    if (state.status === 'failed') {
      return (
        <section className="dg-panel dg-proj" aria-label="Projeto em foco" data-testid="dg-site">
          <Eyebrow uf={marker?.position.uf ?? null} />
          <h1 className="dg-title">{marker?.name ?? 'Projeto'}</h1>
          <Failed what="O local" message={state.message} onRetry={onRetry} />
        </section>
      );
    }
    return (
      <section className="dg-panel dg-proj" aria-label="Projeto em foco" data-testid="dg-site" aria-busy="true">
        <Eyebrow uf={marker?.position.uf ?? null} />
        <h1 className="dg-title">{marker?.name ?? 'Carregando o local…'}</h1>
        {marker?.client && <p className="dg-sub">{marker.client}</p>}
        <div role="status" aria-label="Carregando o local…"><SkeletonLines lines={6} /></div>
      </section>
    );
  }
  if (!data.ok) return <SiteFailure fail={data} marker={marker} onRetry={onRetry} onBack={onBack} />;
  return <Focus hud={data} marker={marker} onNavigate={onNavigate} />;
}

function Eyebrow({ uf }: { uf: string | null }) {
  return <div className="dg-eyebrow"><Radar size={14} aria-hidden className="dg-ico" /><span>Projeto em foco{uf ? ` · ${uf}` : ''}</span></div>;
}

function SiteFailure({ fail, marker, onRetry, onBack }: { fail: Fail; marker: SiteMarker | null; onRetry: () => void; onBack: () => void }) {
  const text = fail.reason === 'restricted' ? 'O seu perfil não lê este projeto.'
    : fail.reason === 'not_found' ? 'Este projeto não existe nesta empresa (ou não está mais disponível).'
      : fail.reason === 'invalid' ? 'O endereço do projeto é inválido.'
        : null;
  return (
    <section className="dg-panel dg-proj" aria-label="Projeto em foco" data-testid="dg-site">
      <Eyebrow uf={marker?.position.uf ?? null} />
      <h1 className="dg-title">{marker?.name ?? 'Projeto'}</h1>
      {fail.reason === 'restricted' ? <Restricted>{text}</Restricted>
        : fail.reason === 'error' ? <Failed what="O local" message={fail.message} onRetry={onRetry} />
          : <p className="dg-state" data-kind="muted"><MapPinOff size={14} aria-hidden /><span>{text}</span></p>}
      <button type="button" className="dg-link" onClick={onBack}>Voltar ao portfólio<ChevronRight size={14} aria-hidden /></button>
    </section>
  );
}

function Focus({ hud, marker, onNavigate }: { hud: SiteHud; marker: SiteMarker | null; onNavigate: (m: ModuleId) => void }) {
  const loc = hud.location.state === 'ok' ? hud.location.data : null;
  const position: SitePosition | null = loc?.position ?? marker?.position ?? null;
  const now = hud.now.state === 'ok' ? hud.now.data : null;
  const os = now && now.serviceOrders.state === 'ok' ? now.serviceOrders.data[0] ?? null : null;
  const supply = hud.supply.state === 'ok' ? hud.supply.data : null;
  const shortage = !!supply && supply.shortages.total > 0;

  return (
    <section className="dg-panel dg-proj" aria-labelledby="dg-proj-title" data-testid="dg-site">
      <Eyebrow uf={position?.uf ?? null} />
      <h1 className="dg-title" id="dg-proj-title">{hud.project.name}</h1>
      {hud.project.client && <p className="dg-sub">{hud.project.client}</p>}

      {/* metadado (OS, código) = HudSignal chip; o lugar e o estado da posição = inline (sem trilho) */}
      <div className="dg-chips">
        {os && <HudSignal size="sm" tone="neutral" label="OS" value={os.number} href={os.href} title={os.statusLabel} />}
        {hud.project.code && <HudSignal size="sm" tone="neutral" label={hud.project.code} title="Código do projeto" />}
        {position ? (
          <HudSignal variant="inline" size="sm" tone="accent" icon={<MapPin aria-hidden />} title={sourceLong(position)}
            label={`${[position.label ?? position.municipality, position.uf].filter(Boolean).join(' · ') || 'Local'} · ${position.source === 'canonical' ? 'oficial' : 'canteiro'}`} />
        ) : hud.location.state === 'restricted' ? (
          <HudSignal variant="inline" size="sm" tone="neutral" icon={<Lock aria-hidden />} label="Localização restrita" />
        ) : hud.location.state === 'error' ? (
          <HudSignal variant="inline" size="sm" tone="warning" label="Localização não carregou" />
        ) : (
          <HudSignal variant="inline" size="sm" tone="neutral" icon={<MapPinOff aria-hidden />}
            label={loc?.pending ? PENDING_LABEL[loc.pending.state] : 'sem localização apurada'} />
        )}
      </div>
      {position && <p className="dg-source">{sourceLong(position)}</p>}

      {hud.project.scope && (
        <div className="dg-scope"><small>Escopo</small><p>{hud.project.scope}</p></div>
      )}

      <div className="dg-grid">
        <PhaseTile hud={hud} />
        <MilestoneTile hud={hud} />
        <TeamTile hud={hud} />
        <ContractTile hud={hud} />
      </div>

      <AttentionCard hud={hud} />

      <div className="dg-proj-links">
        {shortage
          ? <button type="button" className="dg-link" onClick={() => onNavigate('supply')}><Radar size={14} aria-hidden />Ver plano do Apex<ChevronRight size={14} aria-hidden /></button>
          : <button type="button" className="dg-link" onClick={() => onNavigate('plan')}>Ver cronograma<ChevronRight size={14} aria-hidden /></button>}
        <Link className="dg-link quiet" href={hud.project.href}>Abrir o projeto<ArrowUpRight size={13} aria-hidden /></Link>
      </div>
    </section>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return <div className="dg-tile"><small>{label}</small>{children}</div>;
}

function PhaseTile({ hud }: { hud: SiteHud }) {
  if (hud.now.state === 'restricted') return <Tile label="Fase atual"><b className="dg-muted"><Lock size={12} aria-hidden />Restrito</b></Tile>;
  if (hud.now.state === 'error') return <Tile label="Fase atual"><b className="dg-muted">—</b><em>não carregou</em></Tile>;
  const { phase, progress, schedule } = hud.now.data;
  if (!phase) {
    return (
      <Tile label="Fase atual">
        <b className="dg-muted">{schedule ? 'Nenhuma em andamento' : 'Sem cronograma'}</b>
        {progress && <><span className="dg-bar" role="img" aria-label={`Avanço físico ${progress.percent}%`}><i style={{ width: `${pctWidth(progress.percent)}%` }} /></span><em className="num">avanço físico {fmtPct(progress.percent)}</em></>}
      </Tile>
    );
  }
  const pct = phase.percent;
  return (
    <Tile label="Fase atual">
      <b title={phase.title}>{phase.title}</b>
      {pct !== null && Number.isFinite(pct) ? (
        <>
          <span className="dg-bar" role="img" aria-label={`${fmtPct(pct)} concluído`}><i style={{ width: `${pctWidth(pct)}%` }} /></span>
          <em className="num">{fmtPct(pct)}</em>
        </>
      ) : <em>sem % registrado</em>}
    </Tile>
  );
}

const pctWidth = (p: number) => Math.min(100, Math.max(0, Number.isFinite(p) ? p : 0));
const fmtPct = (p: number) => `${Math.round(pctWidth(p)).toLocaleString('pt-BR')}%`;

function MilestoneTile({ hud }: { hud: SiteHud }) {
  if (hud.now.state === 'restricted') return <Tile label="Próximo marco"><b className="dg-muted"><Lock size={12} aria-hidden />Restrito</b></Tile>;
  if (hud.now.state === 'error') return <Tile label="Próximo marco"><b className="dg-muted">—</b><em>não carregou</em></Tile>;
  const m = hud.now.data.nextMilestone;
  if (!m) return <Tile label="Próximo marco"><b className="dg-muted">Sem marco</b><em>no cronograma</em></Tile>;
  const late = m.date < hud.today;
  return (
    <Tile label="Próximo marco">
      <b title={m.title ?? undefined}>{m.title ?? 'Marco do cronograma'}</b>
      <em className="num" data-late={late ? 'true' : undefined}>{filmDate(m.date)}{late ? ' · vencido' : ''}</em>
    </Tile>
  );
}

function TeamTile({ hud }: { hud: SiteHud }) {
  if (hud.now.state !== 'ok') {
    return <Tile label="Equipe">{hud.now.state === 'restricted' ? <b className="dg-muted"><Lock size={12} aria-hidden />Restrito</b> : <><b className="dg-muted">—</b><em>não carregou</em></>}</Tile>;
  }
  const t = hud.now.data.team;
  if (t.state === 'restricted') return <Tile label="Equipe"><b className="dg-muted"><Lock size={12} aria-hidden />Restrito</b><em>alocação não visível ao seu perfil</em></Tile>;
  if (t.state === 'error') return <Tile label="Equipe"><b className="dg-muted">—</b><em>não carregou</em></Tile>;
  const n = t.data.allocated;
  return (
    <Tile label="Equipe">
      <b className="num">{n === 0 ? 'Ninguém alocado' : `${nf(n)} ${n === 1 ? 'pessoa' : 'pessoas'}`}</b>
      <em>{n === 0 ? 'sem alocação registrada' : 'alocadas no projeto'}</em>
    </Tile>
  );
}

function ContractTile({ hud }: { hud: SiteHud }) {
  if (hud.contract.state === 'restricted') return <Tile label="Contrato"><b className="dg-muted"><Lock size={12} aria-hidden />Restrito</b></Tile>;
  if (hud.contract.state === 'error') return <Tile label="Contrato"><b className="dg-muted">—</b><em>não carregou</em></Tile>;
  const links = hud.contract.data.links;
  if (links.length === 0) return <Tile label="Contrato"><b className="dg-muted">Sem contrato</b><em>vinculado ao projeto</em></Tile>;
  const billing = hud.billing.state === 'ok' ? hud.billing.data : null;
  const title = links.length === 1 ? links[0].label : `${links.length} contratos`;
  return (
    <Tile label="Contrato">
      <b className={billing?.total ? 'num' : undefined} title={links.map((l) => l.label).join(' · ')}>{billing?.total ?? title}</b>
      <em>
        {billing
          ? `${billing.total ? `${title} · ` : ''}${plural(billing.events, 'evento', 'eventos')}${billing.invoicesToIssue > 0 ? ` · ${billing.invoicesToIssue} a faturar` : billing.awaitingRelease > 0 ? ` · ${billing.awaitingRelease} a liberar` : ''}`
          : hud.billing.state === 'restricted' ? 'faturamento restrito ao seu perfil'
            : hud.billing.state === 'error' ? 'faturamento não carregou' : ''}
      </em>
    </Tile>
  );
}

const plural = (n: number, one: string, many: string) => `${nf(n)} ${n === 1 ? one : many}`;

/** A linha mais grave do local com a próxima ação — ou, só quando tudo foi lido, "sem pendência". */
function AttentionCard({ hud }: { hud: SiteHud }) {
  const att = hud.attention;
  if (att.state === 'restricted') return <div className="dg-risk" data-tone="muted"><Lock size={16} aria-hidden /><div><b>Atenção restrita</b><span>O seu perfil não lê as áreas que alimentam a fila deste local.</span></div></div>;
  if (att.state === 'error') return <div className="dg-risk" data-tone="warn"><TriangleAlert size={16} aria-hidden /><div><b>A fila deste local não carregou</b><span>{att.message}</span></div></div>;
  const feed = att.data;
  const top = feed.rows[0] ?? null;
  const otherErrors = (['now', 'measurements', 'risks', 'supply', 'contract', 'billing', 'decisions'] as const)
    .filter((k) => hud[k].state === 'error');
  if (!top) {
    if (feed.failed.length > 0 || feed.partial || otherErrors.length > 0) {
      return (
        <div className="dg-risk" data-tone="warn"><TriangleAlert size={16} aria-hidden />
          <div><b>Leitura incompleta deste local</b><span>{feed.failed.length > 0 ? `Não carregou: ${feed.failed.map((f) => f.label).join(', ')}.` : 'Parte das leituras não carregou — não dá para dizer que está tudo em ordem.'}</span></div>
        </div>
      );
    }
    return <div className="dg-risk" data-tone="ok"><ShieldCheck size={16} aria-hidden /><div><b>Sem pendência neste local</b><span>Nada fora do lugar nas áreas que o seu perfil lê.</span></div></div>;
  }
  const more = feed.total - 1;
  const tone = severityTone(top.severity) === 'danger' ? 'danger' : 'warn';
  const action = hud.nextAction ?? top.nextAction;
  return (
    <div className="dg-risk-wrap">
      <div className="dg-risk" data-tone={tone}>
        <TriangleAlert size={16} aria-hidden />
        <div>
          <b>{more > 0 ? `${nf(feed.total)}${feed.partial ? '+' : ''} pendências · ` : ''}{top.object}</b>
          <span>{top.problem}{top.consequence ? ` · ${top.consequence}` : ''}</span>
        </div>
      </div>
      <Link className="dg-link" href={action.href}>{action.label}<ArrowUpRight size={13} aria-hidden /></Link>
    </div>
  );
}

function sectionValue<T>(s: SectionState<T>, f: (d: T) => ReactNode): ReactNode {
  if (s.state === 'restricted') return <span className="dg-muted"><Lock size={11} aria-hidden />Restrito</span>;
  if (s.state === 'error') return <span className="dg-muted">não carregou</span>;
  return f(s.data);
}

/**
 * Faturamento lido e sem evento: o escopo são os contratos vinculados ao projeto —
 * sem nenhum vinculado, diz isso (como o ladrilho "Contrato" e o módulo), nunca
 * "sem eventos nos contratos vinculados", que sugere que eles existem.
 */
function noBillingEvents(contract: SiteHud['contract']): string {
  if (contract.state !== 'ok') return 'sem eventos de faturamento';
  return contract.data.links.length === 0 ? 'sem contrato vinculado' : 'sem eventos nos contratos vinculados';
}

/** "Neste local" — medições, riscos, faltas e faturamento, cada um com o seu estado (Restrito / não carregou nunca é 0). */
export function SiteFacts({ hud }: { hud: SiteHud }) {
  const rows: Array<[string, ReactNode]> = [
    ['Medições', sectionValue(hud.measurements, (d) =>
      `${nf(d.pending)} ${d.pending === 1 ? 'pendente' : 'pendentes'}${d.awaitingCustomer ? ` · ${d.awaitingCustomer} com o cliente` : ''}${d.inCorrection ? ` · ${d.inCorrection} em correção` : ''}`)],
    ['Riscos', sectionValue(hud.risks, (d) =>
      d.open === 0 ? 'nenhum aberto' : `${nf(d.open)} ${d.open === 1 ? 'aberto' : 'abertos'}${d.critical + d.high > 0 ? ` · ${d.critical + d.high} alto/crítico` : ''}${d.withoutOwner ? ` · ${d.withoutOwner} sem responsável` : ''}`)],
    ['Materiais', sectionValue(hud.supply, (d) =>
      d.shortages.total === 0 ? (d.shortages.partial ? 'leitura parcial — sem falta no que foi lido' : 'sem falta')
        : `${nf(d.shortages.total)}${d.shortages.partial ? '+' : ''} ${d.shortages.total === 1 ? 'falta' : 'faltas'}${d.apexOpen ? ` · ${d.apexOpen} ${d.apexOpen === 1 ? 'achado' : 'achados'} da Apex` : ''}`)],
    ['Faturamento', sectionValue(hud.billing, (d) =>
      d.events === 0 ? noBillingEvents(hud.contract)
        : `${plural(d.events, 'evento', 'eventos')}${d.invoicesToIssue ? ` · ${d.invoicesToIssue} a faturar` : ''}${d.awaitingRelease ? ` · ${d.awaitingRelease} a liberar` : ''}`)],
  ];
  return (
    <dl className="dg-kv" aria-label="Neste local">
      {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}
