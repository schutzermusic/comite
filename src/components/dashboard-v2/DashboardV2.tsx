'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { AxPage, CommandHeader, Dot, ErrorState, dateTime, plural, todayIso, useResource, useUrlParam } from '@/components/ax';
import { refreshDecisionBadge, useDecisionBadgeState } from '@/hooks/use-decision-badge';
import { useCurrentUser } from '@/hooks/use-current-user';
import type { DashboardOverview } from '@/lib/dashboard/types';
import { AttentionFeed, failedAreasText } from './AttentionFeed';
import { BusinessFlow } from './BusinessFlow';
import { CompanyCalendar } from './CompanyCalendar';
import { DecisionsGlance, DecisionsLine } from './DecisionsGlance';
import { DashboardSkeleton } from './DashboardSkeleton';
import { ExplainPanel } from './ExplainPanel';
import { ProjectsHealth } from './ProjectsHealth';
import './dashboard-v2.css';

type Payload = DashboardOverview;

/** Tempo mínimo entre releituras automáticas ao voltar para a aba. */
const REFOCUS_MS = 120_000;

/**
 * O QUE ESTÁ ACONTECENDO — a visão da empresa.
 *
 * A ordem da tela é a ordem do raciocínio: onde o trabalho está parado no
 * fluxo do negócio, o que exige atenção agora (e por quê, sob "Entender"),
 * o que aguarda a pessoa em Decisões, como estão os projetos e o que vence
 * nos próximos 30 dias. No celular, a mesma árvore em outra ordem: atenção
 * primeiro.
 */
export function DashboardV2() {
  const res = useResource<Payload>('/api/dashboard/overview');
  const { refresh } = res;

  /*
    Recarga do mesmo endereço mantém o dado anterior na tela (o recurso segue
    "pronto"), então o "recarregando" é daqui: vale do pedido até o dado
    mostrado mudar de identidade — chegou o novo, ou a leitura falhou.
  */
  const shown = useRef<Payload | null>(null);
  const lastLoad = useRef(0);
  const [reloadOf, setReloadOf] = useState<Payload | null>(null);
  const reloading = reloadOf !== null && reloadOf === res.data;
  useEffect(() => {
    shown.current = res.data;
    if (res.data) lastLoad.current = Date.now();
  }, [res.data]);

  const reread = useCallback((badge: boolean) => {
    setReloadOf(shown.current);
    refresh();
    if (badge) refreshDecisionBadge();
  }, [refresh]);
  const reload = useCallback(() => reread(true), [reread]);

  // Voltar para a aba depois de um tempo relê a situação (sem polling com a aba escondida).
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (!lastLoad.current || Date.now() - lastLoad.current <= REFOCUS_MS) return;
      // `visibilitychange` e `focus` chegam juntos ao voltar: marca antes, para a segunda não reler de novo.
      lastLoad.current = Date.now();
      reread(false);
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reread]);

  return (
    <AxPage testId="dashboard-v2">
      {res.data ? <Board data={res.data} reload={reload} loading={reloading} />
        : res.state === 'loading' ? <DashboardSkeleton />
          : (
            <div className="dv2">
              <CommandHeader eyebrow="Visão da empresa" title="O que está acontecendo" />
              <ErrorState message={res.message} onRetry={reload} />
            </div>
          )}
    </AxPage>
  );
}

function Board({ data, reload, loading }: { data: Payload; reload: () => void; loading: boolean }) {
  const { organization } = useCurrentUser();
  const badge = useDecisionBadgeState();
  const [explain, setExplain] = useUrlParam<string>('x', '');
  const feed = data.feed.state === 'ok' ? data.feed.data : null;
  const decisions = data.decisions.state === 'ok' ? data.decisions.data : null;
  // O número em destaque é o MESMO do selo; até a primeira leitura do selo, vale o do servidor.
  const decisionCount = decisions ? (badge.known ? badge.count : decisions.count) : null;

  return (
    <div className="dv2" data-loading={loading ? 'true' : undefined} aria-busy={loading || undefined}>
      <CommandHeader
        eyebrow={<><b>{organization?.name ?? 'Sua empresa'}</b> · Visão da empresa</>}
        title="O que está acontecendo"
        context={<HeaderContext data={data} />}
        actions={<>
          <Link className="ax-btn" href="/decisoes" aria-label={decisionCount !== null ? `Decisões: ${decisionCount} aguardando você` : 'Decisões'}>
            Decisões
            {decisionCount !== null && decisionCount > 0 && <span className="ax-count danger" aria-hidden>{decisionCount}</span>}
            <ArrowUpRight size={14} aria-hidden />
          </Link>
          <button type="button" className="ax-btn ghost icon" onClick={reload}
            aria-label={loading ? 'Recarregando a situação…' : 'Recarregar a situação'} title={loading ? 'Recarregando…' : 'Recarregar'}>
            <RefreshCw size={15} className={loading ? 'spin' : undefined} aria-hidden />
          </button>
        </>} />

      <div className="dv2-board">
        {decisions && decisionCount !== null && decisionCount > 0 && (
          <div className="dv2-slot dv2-slot-decisions-line">
            <DecisionsLine model={decisions} count={decisionCount} />
          </div>
        )}

        <div className="dv2-slot dv2-slot-flow">
          <BusinessFlow stages={data.stages} hasOperation={data.hasOperation} />
        </div>

        <div className="dv2-slot dv2-slot-main ax-grid main-side">
          <AttentionFeed section={data.feed} today={data.today} readable={data.readable} hasOperation={data.hasOperation}
            apex={data.apex} onExplain={setExplain} onReload={reload} />
          <div className="ax-stack">
            <DecisionsGlance section={data.decisions} count={decisionCount} today={data.today} />
            <ProjectsHealth section={data.projects} today={data.today} />
          </div>
        </div>

        <div className="dv2-slot dv2-slot-calendar">
          <CompanyCalendar section={data.calendar} today={data.today} />
        </div>

        <footer className="dv2-slot dv2-slot-foot">
          <p className="ax-note"><ShieldCheck size={13} aria-hidden />
            Cada número vem de um registro canônico e abre esse registro. O que o seu perfil não lê aparece como
            &ldquo;Restrito&rdquo;, nunca como zero; nada é executado a partir daqui — as ações abrem o fluxo governado de cada área.
          </p>
          {data.notReadable.length > 0 && (
            <p className="ax-note dv2-scope">Seu perfil não lê: {data.notReadable.join(', ')}.</p>
          )}
          {feed && data.apex && (
            <p className="ax-note dv2-scope">
              {data.apex.lastRun
                ? <>Achados da Apex: leitura determinística de {dateTime(data.apex.lastRun.ranAt)} · motor {data.apex.lastRun.engineVersion}.</>
                : <>Ainda sem leitura da Apex neste inquilino — os achados aparecem após a primeira varredura.</>}
            </p>
          )}
        </footer>
      </div>

      {explain && <ExplainPanel reference={explain} today={data.today} onClose={() => setExplain(null)} />}
    </div>
  );
}

/**
 * A frase do cabeçalho: quantas exceções, quantas críticas, quando foi lido.
 * Fila parcial nunca diz "0 exceções": diz o que não carregou; total lido
 * com corte é piso ("ao menos 259 exceções").
 */
export function HeaderContext({ data }: { data: Payload }) {
  const feed = data.feed.state === 'ok' ? data.feed.data : null;
  const failed = feed ? failedAreasText(feed) : null;
  const floor = !!feed && (feed.partial || failed !== null);
  // O dia da leitura em São Paulo (o mesmo relógio do `today` do servidor), não em UTC.
  const generatedDay = todayIso(new Date(data.generatedAt));
  const when = dateTime(data.generatedAt);
  const time = when.includes(' ') ? when.split(' ').pop() : when;
  return (
    <>
      {feed ? (
        failed && feed.total === 0
          ? <span>Fila de atenção incompleta</span>
          : <span>{floor ? 'ao menos ' : ''}<strong>{plural(feed.total, 'exceção', 'exceções')}</strong></span>
      ) : data.feed.state === 'restricted' ? <span>Fila de atenção restrita ao seu perfil</span>
        : <span>A fila de atenção não carregou</span>}
      {feed && feed.critical > 0 && (
        <span><Dot tone="danger" label="crítico" />{floor ? 'ao menos ' : ''}<strong>{feed.critical}</strong> {feed.critical === 1 ? 'crítica' : 'críticas'}</span>
      )}
      {failed && <span className="dv2-head-failed"><TriangleAlert size={13} aria-hidden />{failed}</span>}
      <span>{generatedDay === data.today ? `Atualizado às ${time}` : `Atualizado em ${when}`}</span>
    </>
  );
}
