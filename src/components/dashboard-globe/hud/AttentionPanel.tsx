'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CornerDownRight, MapPin, Radar, ShieldCheck, TriangleAlert } from 'lucide-react';
import { relativeDue } from '@/components/ax/format';
import { failedAreasText } from '@/components/dashboard-v2/AttentionFeed';
import { HudSignal } from '@/components/hud';
import type { DashboardOverview, FeedModel, FeedRow, SectionState } from '@/lib/dashboard/types';
import { Failed, Restricted, SEVERITY_LABEL, nf, severityTone, signalTone } from './common';

/**
 * ATENÇÃO — a fila única entre áreas, compacta (estilo do protótipo).
 *
 * No portfólio: as 5 linhas mais graves da empresa ("Ver mais" abre as
 * demais já lidas). No local: as linhas do projeto — as MESMAS do Dashboard
 * (mesmo `key` e `explainRef`), então "Entender" funciona igual.
 *
 * Fila parcial diz o que não carregou (nunca "Nada fora do lugar" nem
 * "0 exceções"); total lido com corte é piso ("259+").
 */
export function AttentionPanel({
  section, today, title, limit, hasOperation, apex, onExplain, onOpenSite, locatedIds, testId = 'dashboard-attention', scope = 'org', onReload,
}: {
  section: SectionState<FeedModel>;
  today: string;
  title: string;
  /** Linhas antes de "Ver mais". */
  limit: number;
  hasOperation: boolean | null;
  apex?: DashboardOverview['apex'];
  onExplain: (ref: string) => void;
  /** Abre o local no globo (só projetos com posição). */
  onOpenSite?: (projectId: string) => void;
  locatedIds?: Set<string>;
  testId?: string;
  scope?: 'org' | 'site';
  onReload?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const head = (count: ReactNode) => (
    <div className="dg-panel-head">
      <div className="dg-eyebrow"><TriangleAlert size={14} aria-hidden className="dg-ico" /><span>{title}</span></div>
      {count}
    </div>
  );

  if (section.state === 'restricted') {
    return (
      <section className="dg-panel dg-att" aria-label={title} data-testid={testId}>
        {head(null)}
        <Restricted>o seu perfil não lê nenhuma das áreas que alimentam esta fila.</Restricted>
      </section>
    );
  }
  if (section.state === 'error') {
    return (
      <section className="dg-panel dg-att" aria-label={title} data-testid={testId} data-tone="warn">
        {head(null)}
        <Failed what="A fila de atenção" message={section.message} onRetry={onReload} />
      </section>
    );
  }

  const feed = section.data;
  const failed = failedAreasText(feed);
  const floor = feed.partial || failed !== null;
  const tone = feed.critical > 0 ? 'danger' : feed.total > 0 ? 'warn' : undefined;
  const rows = expanded ? feed.rows : feed.rows.slice(0, limit);
  const hidden = feed.rows.length - rows.length;
  const beyond = Math.max(0, feed.total - feed.rows.length);

  // O painel acende (aresta + brilho) com crítica aberta, ou âmbar quando parte da fila não carregou.
  const panelTone = failed ? 'warn' : tone === 'danger' ? 'danger' : undefined;
  return (
    <section className="dg-panel dg-att" aria-label={title} data-testid={testId} data-tone={panelTone}>
      {head(feed.total > 0 ? (
        <span className="dg-head-signal">
          <HudSignal variant="inline" tone={signalTone(tone)} label={feed.total === 1 && !floor ? 'aberta' : 'abertas'}
            value={`${nf(feed.total)}${floor ? '+' : ''}`}
            title={floor ? 'Ao menos este número — parte da fila não foi lida por inteiro' : undefined} />
        </span>
      ) : null)}
      {feed.critical > 0 && (
        <p className="dg-att-sub">{floor ? 'ao menos ' : ''}<b className="num">{nf(feed.critical)}</b> {feed.critical === 1 ? 'crítica' : 'críticas'} · da mais grave para a menos grave</p>
      )}
      {failed && (
        <p className="dg-state" data-kind="error" role="status"><TriangleAlert size={13} aria-hidden /><span><b>{failed}</b> — a fila pode estar incompleta.</span></p>
      )}
      {feed.total === 0 ? (
        failed ? null
          : hasOperation === false && scope === 'org' ? (
            <p className="dg-empty">Ainda não há operação para acompanhar. As exceções aparecem aqui quando o primeiro projeto entrar em execução.</p>
          ) : hasOperation === true || scope === 'site' ? (
            <p className="dg-calm"><ShieldCheck size={15} aria-hidden />
              <span>{scope === 'site' ? 'Sem pendência neste local nas áreas que o seu perfil lê.' : 'Nada fora do lugar nas áreas que o seu perfil lê.'}
                {apex && !apex.lastRun ? ' A Apex ainda não fez a primeira leitura deste inquilino.' : ''}</span>
            </p>
          ) : (
            <p className="dg-calm"><ShieldCheck size={15} aria-hidden /><span>Nenhuma exceção aberta nas áreas que o seu perfil lê.</span></p>
          )
      ) : rows.length === 0 ? (
        <p className="dg-empty">{nf(beyond)}{feed.partial ? ' ou mais' : ''} {beyond === 1 ? 'exceção' : 'exceções'} além das listadas — abra cada área para a lista completa.</p>
      ) : (
        <ol className="dg-att-list">
          {rows.map((r) => (
            <Row key={r.key} row={r} today={today} onExplain={onExplain}
              onOpenSite={onOpenSite && r.location.kind === 'project' && r.location.id && locatedIds?.has(r.location.id) ? onOpenSite : undefined}
              showWhere={scope === 'org'} />
          ))}
        </ol>
      )}
      {(hidden > 0 || beyond > 0) && (
        <div className="dg-att-foot">
          {hidden > 0 && <button type="button" className="dg-mini" onClick={() => setExpanded(true)}>Ver mais {hidden}</button>}
          {beyond > 0 && <span>+{nf(beyond)}{feed.partial ? ' ou mais' : ''} além das {feed.rows.length} mais graves</span>}
        </div>
      )}
    </section>
  );
}

function Row({ row: r, today, onExplain, onOpenSite, showWhere }: {
  row: FeedRow; today: string; onExplain: (ref: string) => void; onOpenSite?: (id: string) => void; showWhere: boolean;
}) {
  const due = r.due ? relativeDue(r.due, today) : null;
  return (
    <li className="dg-att-row" data-sev={r.severity}>
      <span className="dg-att-top">
        <HudSignal variant="inline" size="sm" tone={signalTone(severityTone(r.severity))} label={SEVERITY_LABEL[r.severity]} />
        <span className="dg-kind">{r.kindLabel}</span>
        {showWhere && r.location.label && (onOpenSite && r.location.id ? (
          <button type="button" className="dg-where" onClick={() => onOpenSite(r.location.id as string)} title={`Ver ${r.location.label} no globo`}
            aria-label={`Ver ${r.location.label} no globo`}>
            <MapPin size={11} aria-hidden />{r.location.label}
          </button>
        ) : <span className="dg-where" title={r.location.label}>{r.location.label}</span>)}
      </span>
      <b className="dg-att-obj">{r.object}{r.count > 1 && (
        <span className="dg-att-n">
          <HudSignal variant="inline" size="sm" tone="neutral" label="registros" value={nf(r.count)} title={`${r.count} registros nesta linha`} />
        </span>
      )}</b>
      <span className="dg-att-prob">{r.problem}</span>
      {r.consequence && <span className="dg-att-cons"><CornerDownRight size={12} aria-hidden /><span>{r.consequence}</span></span>}
      {r.apex && (
        <span className="dg-att-apex" data-stale={r.apex.stale ? 'true' : undefined}><Radar size={12} aria-hidden />{r.apex.lead}</span>
      )}
      <span className="dg-att-foot-row">
        {due && <span className="dg-due" data-late={due.late ? 'true' : undefined} title={r.due ?? undefined}>{due.late ? `venceu ${due.text}` : `vence ${due.text}`}</span>}
        {r.ownerApplicable && (r.owner ? <span className="dg-owner">Resp.: <b>{r.owner}</b></span> : <span className="dg-owner" data-none="true">sem responsável</span>)}
        <span className="dg-att-actions">
          {r.explainRef && (
            <button type="button" className="dg-mini" onClick={() => onExplain(r.explainRef as string)} aria-label={`Entender: ${r.object}`}>Entender</button>
          )}
          <Link className="dg-mini accent" href={r.nextAction.href} title={r.nextAction.focused ? undefined : 'Abre a área — o registro não pode ser focado por link'}>
            {r.nextAction.label}<ArrowUpRight size={12} aria-hidden />
          </Link>
        </span>
      </span>
    </li>
  );
}
