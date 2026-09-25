'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CornerDownRight, Radar, ShieldCheck, Sparkles } from 'lucide-react';
import { EmptyState, Filters, Plane, dateTime, relativeDue } from '@/components/ax';
import { DOMAIN_LABEL, type DashboardOverview, type Domain, type FeedRow, type SectionState, type FeedModel } from '@/lib/dashboard/types';

const DESKTOP_ROWS = 8;
/** No celular a fila mostra menos linhas (o CSS esconde da 6ª em diante até expandir). */
const MOBILE_ROWS = 5;
const SEVERITY_LABEL: Record<FeedRow['severity'], string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio' };

/**
 * ATENÇÃO AGORA — uma fila só, entre áreas.
 *
 * A ordem já vem do servidor (gravidade → prazo → área, com a primeira linha
 * crítica de cada área no topo). Cada linha diz ONDE, O QUÊ, QUAL o problema,
 * POR QUE importa (o primeiro elo canônico a jusante), o PRAZO, QUEM responde
 * e a PRÓXIMA AÇÃO no fluxo governado da área. "Entender" abre a cadeia
 * causal com a evidência.
 */
export function AttentionFeed({ section, today, readable, hasOperation, apex, onExplain }: {
  section: SectionState<FeedModel>; today: string; readable: Domain[]; hasOperation: boolean;
  apex: DashboardOverview['apex']; onExplain: (ref: string) => void;
}) {
  const [domain, setDomain] = useState<'all' | Domain>('all');
  const [expanded, setExpanded] = useState(false);
  const feed = section.state === 'ok' ? section.data : null;
  const rows = useMemo(() => (feed?.rows ?? []).filter((r) => domain === 'all' || r.domain === domain), [feed, domain]);

  if (section.state === 'restricted') {
    return (
      <Plane title="Atenção agora" testId="dashboard-attention">
        <EmptyState compact title="Restrito">O seu perfil não lê nenhuma das áreas que alimentam esta fila.</EmptyState>
      </Plane>
    );
  }
  if (section.state === 'error' || !feed) {
    return (
      <Plane title="Atenção agora" testId="dashboard-attention">
        <EmptyState compact title="A fila não carregou">
          {section.state === 'error' ? section.message : 'O servidor não respondeu.'} As demais seções seguem válidas.
        </EmptyState>
      </Plane>
    );
  }

  const domains = (Object.keys(DOMAIN_LABEL) as Domain[]).filter((d) => readable.includes(d) && (feed.byDomain[d]?.total ?? 0) > 0);
  const shown = expanded ? rows : rows.slice(0, DESKTOP_ROWS);
  const hidden = rows.length - shown.length;
  const hiddenMobile = expanded ? 0 : rows.length - Math.min(rows.length, MOBILE_ROWS);
  const more = feed.total - (feed.rows.length);

  return (
    <Plane title="Atenção agora" count={feed.total} countTone={feed.critical > 0 ? 'danger' : feed.total > 0 ? 'warning' : undefined}
      subtitle="Exceções de todas as áreas, da mais grave para a menos grave — cada linha diz por que importa e o que fazer"
      flush testId="dashboard-attention"
      bar={domains.length > 1 ? (
        <Filters label="Filtrar por área" value={domain} onChange={(d) => { setDomain(d); setExpanded(false); }} options={[
          { id: 'all' as const, label: 'Tudo', count: feed.total },
          ...domains.map((d) => ({ id: d, label: DOMAIN_LABEL[d], count: feed.byDomain[d]?.total })),
        ]} />
      ) : undefined}>
      {feed.total === 0 ? (
        hasOperation ? (
          <EmptyState title="Nada fora do lugar" icon={<ShieldCheck size={18} />}>
            Nenhuma OS travada, atividade vencida, falta de material perto da necessidade, medição devolvida, compra parada ou
            faturamento esperando nas áreas que o seu perfil lê.
            {apex && !apex.lastRun && <> A Apex ainda não fez a primeira leitura deste inquilino.</>}
          </EmptyState>
        ) : (
          <EmptyState title="Ainda não há operação para acompanhar" icon={<Sparkles size={18} />}
            action={<div className="dv2-empty-actions">
              <Link className="ax-btn sm primary" href="/comercial">Abrir Comercial<ArrowUpRight size={13} aria-hidden /></Link>
              <Link className="ax-btn sm" href="/operacoes/ordens-servico">Ordens de Serviço</Link>
            </div>}>
            A operação nasce de uma proposta aceita: autorização → Ordem de Serviço → projeto com cronograma. Quando o primeiro
            projeto entrar em execução, as exceções aparecem aqui.
          </EmptyState>
        )
      ) : (
        <>
          <ol className="dv2-feed" data-expanded={expanded ? 'true' : undefined}>
            {shown.map((r, i) => <FeedItem key={r.key} row={r} today={today} rank={i} onExplain={onExplain} />)}
          </ol>
          {(hiddenMobile > 0 || (more > 0 && domain === 'all')) && (
            <div className={hidden > 0 || (more > 0 && domain === 'all') ? 'dv2-feed-foot' : 'dv2-feed-foot dv2-foot-mobile'}>
              {hidden > 0 && (
                <button type="button" className="ax-btn ghost sm dv2-more-desktop" onClick={() => setExpanded(true)}>
                  Ver mais {hidden}
                </button>
              )}
              {hiddenMobile > 0 && (
                <button type="button" className="ax-btn ghost sm dv2-more-mobile" onClick={() => setExpanded(true)}>
                  Ver mais {hiddenMobile}
                </button>
              )}
              {more > 0 && domain === 'all' && (
                <span className="ax-subtle">+{more.toLocaleString('pt-BR')} além das {feed.rows.length} mais graves — abra cada área para a lista completa</span>
              )}
            </div>
          )}
        </>
      )}
    </Plane>
  );
}

function FeedItem({ row: r, today, rank, onExplain }: { row: FeedRow; today: string; rank: number; onExplain: (ref: string) => void }) {
  const due = r.due ? relativeDue(r.due, today) : null;
  return (
    <li className="dv2-row" data-sev={r.severity} data-rank={rank}>
      <div className="dv2-row-main">
        <span className="dv2-row-eyebrow">
          <span className="dv2-sev" data-sev={r.severity}>{SEVERITY_LABEL[r.severity]}</span>
          <span className="dv2-kind">{r.kindLabel}</span>
          {r.location.label && <span className="dv2-where" title={r.location.label}>{r.location.label}</span>}
        </span>
        <span className="dv2-row-object">
          {r.object}
          {r.count > 1 && <span className="ax-count" title={`${r.count} registros nesta linha`}>{r.count}</span>}
        </span>
        <span className="dv2-row-problem">{r.problem}</span>
        {r.consequence && (
          <span className="dv2-row-consequence"><CornerDownRight size={13} aria-hidden /><span>{r.consequence}</span></span>
        )}
        <span className="dv2-row-meta">
          {due && <span className="dv2-due" data-late={due.late ? 'true' : undefined} title={r.due ?? undefined}>{due.late ? `venceu ${due.text}` : `vence ${due.text}`}</span>}
          {r.ownerApplicable && (r.owner
            ? <span>Resp.: <strong>{r.owner}</strong></span>
            : <span className="dv2-noowner">sem responsável</span>)}
        </span>
        {r.apex && (
          <div className="dv2-apex" data-stale={r.apex.stale ? 'true' : undefined}>
            <span className="dv2-apex-lead"><Radar size={13} aria-hidden />{r.apex.lead}</span>
            <span className="dv2-apex-title">{r.apex.title}</span>
            {r.apex.evidence.length > 0 && (
              <span className="ax-evidence" aria-label="Evidência">
                {r.apex.evidence.slice(0, 3).map((e, i) => (
                  <span key={i}><em>{e.label}</em><strong>{e.value}</strong>{e.source && <em>· {e.source}</em>}</span>
                ))}
              </span>
            )}
            <span className="dv2-apex-meta">
              {r.apex.stale ? 'Leitura anterior da Apex — a situação ao vivo mudou' : r.apex.ranAt ? `Leitura de ${dateTime(r.apex.ranAt)}${r.apex.engineVersion ? ` · motor ${r.apex.engineVersion}` : ''}` : 'Achado persistido da Apex'}
            </span>
          </div>
        )}
      </div>
      <div className="dv2-row-actions">
        <Link className="ax-btn sm" href={r.nextAction.href} title={r.nextAction.focused ? undefined : 'Abre a área — o registro não pode ser focado por link'}>
          {r.nextAction.label}<ArrowUpRight size={13} aria-hidden />
        </Link>
        {r.explainRef && (
          <button type="button" className="ax-btn ghost sm" onClick={() => onExplain(r.explainRef as string)}
            aria-label={`Entender: ${r.object}`}>
            Entender
          </button>
        )}
      </div>
    </li>
  );
}
