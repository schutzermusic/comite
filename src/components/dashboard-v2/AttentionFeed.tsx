'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CornerDownRight, Radar, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { EmptyState, Filters, Plane, dateTime, plural, relativeDue } from '@/components/ax';
import { DOMAIN_LABEL, type DashboardOverview, type Domain, type FeedRow, type SectionState, type FeedModel } from '@/lib/dashboard/types';

const DESKTOP_ROWS = 8;
/** No celular a fila mostra menos linhas (o CSS esconde da 6ª em diante até expandir). */
const MOBILE_ROWS = 5;
const SEVERITY_LABEL: Record<FeedRow['severity'], string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio' };
/** A área inteira de cada domínio — para "abra a área" quando a fila mostra só parte dela. */
const AREA_HREF: Record<Domain, string> = {
  comercial: '/comercial',
  operacao: '/operacoes',
  supply: '/supply',
  medicao: '/operacoes/medicoes',
  faturamento: '/contratos?view=faturamento',
  recebivel: '/contratos?view=faturamento',
};

/** "A", "A e B", "A, B e C". */
const joinPt = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;

/**
 * As fontes cuja leitura FALHOU nesta montagem ("Não carregou: Medição"), ou
 * `null` quando todas responderam. Com qualquer falha a fila é parcial: nunca
 * "Nada fora do lugar", nunca "0 exceções". (Forma com dois-pontos: o rótulo
 * pode ser plural — "Achados da Apex", "Recebíveis".)
 */
export function failedAreasText(feed: Pick<FeedModel, 'failed'>): string | null {
  const labels = [...new Set(feed.failed.map((f) => f.label || DOMAIN_LABEL[f.domain]))];
  if (labels.length === 0) return null;
  return `${labels.length === 1 ? 'Não carregou' : 'Não carregaram'}: ${joinPt(labels)}`;
}

/**
 * O recorte da fila pelo filtro de área.
 *  • `active`: o filtro escolhido só vale se a área ainda tem linhas e há chips
 *    na tela — numa releitura a área pode sumir, e a fila volta para "Tudo"
 *    (nunca uma lista vazia sem controle para sair dela).
 *  • `more`: o que fica além das linhas listadas — na fila inteira, ou na área
 *    filtrada (o número do chip é o total da área; a lista é cortada no servidor).
 */
export function feedSlice(feed: Pick<FeedModel, 'rows' | 'total' | 'byDomain'>, readable: Domain[], domain: 'all' | Domain) {
  const domains = (Object.keys(DOMAIN_LABEL) as Domain[]).filter((d) => readable.includes(d) && (feed.byDomain[d]?.total ?? 0) > 0);
  const active: 'all' | Domain = domain !== 'all' && domains.length > 1 && domains.includes(domain) ? domain : 'all';
  const rows = active === 'all' ? feed.rows : feed.rows.filter((r) => r.domain === active);
  const more = Math.max(0, active === 'all' ? feed.total - feed.rows.length : (feed.byDomain[active]?.total ?? 0) - rows.length);
  return { domains, active, rows, more };
}

/**
 * ATENÇÃO AGORA — uma fila só, entre áreas.
 *
 * A ordem já vem do servidor (gravidade → prazo → área, com a primeira linha
 * crítica de cada área no topo). Cada linha diz ONDE, O QUÊ, QUAL o problema,
 * POR QUE importa (o primeiro elo canônico a jusante), o PRAZO, QUEM responde
 * e a PRÓXIMA AÇÃO no fluxo governado da área. "Entender" abre a cadeia
 * causal com a evidência.
 *
 * Fila parcial (uma fonte falhou) diz o que não carregou; total lido com
 * limite de linhas é piso ("259+"), não exato.
 */
export function AttentionFeed({ section, today, readable, hasOperation, apex, onExplain, onReload }: {
  section: SectionState<FeedModel>; today: string; readable: Domain[]; hasOperation: boolean | null;
  apex: DashboardOverview['apex']; onExplain: (ref: string) => void; onReload?: () => void;
}) {
  const [domain, setDomain] = useState<'all' | Domain>('all');
  const [expanded, setExpanded] = useState(false);

  if (section.state === 'restricted') {
    return (
      <Plane title="Atenção agora" testId="dashboard-attention">
        <EmptyState compact title="Restrito">O seu perfil não lê nenhuma das áreas que alimentam esta fila.</EmptyState>
      </Plane>
    );
  }
  if (section.state === 'error') {
    return (
      <Plane title="Atenção agora" testId="dashboard-attention">
        <EmptyState compact title="A fila não carregou">
          {section.message} As demais seções seguem válidas.
        </EmptyState>
      </Plane>
    );
  }

  const feed = section.data;
  const { domains, active, rows, more } = feedSlice(feed, readable, domain);
  const shown = expanded ? rows : rows.slice(0, DESKTOP_ROWS);
  const hidden = rows.length - shown.length;
  const hiddenMobile = expanded ? 0 : rows.length - Math.min(rows.length, MOBILE_ROWS);
  const orMore = feed.partial ? ' ou mais' : '';
  const failedText = failedAreasText(feed);
  // Piso: alguma fonte veio com corte, ou alguma não carregou.
  const floor = feed.partial || failedText !== null;
  const countTone = feed.critical > 0 ? 'danger' : feed.total > 0 ? 'warning' : undefined;

  const moreNote = more > 0 && (active === 'all' ? (
    <span className="ax-subtle">+{more.toLocaleString('pt-BR')}{orMore} além das {feed.rows.length} mais graves — abra cada área para a lista completa</span>
  ) : (
    <span className="ax-subtle dv2-feed-area-note">
      +{more.toLocaleString('pt-BR')}{orMore} nesta área além das listadas —{' '}
      <Link href={AREA_HREF[active]}>abra {DOMAIN_LABEL[active]}<ArrowUpRight size={12} aria-hidden /></Link>
    </span>
  ));

  return (
    <Plane
      title={floor && feed.total > 0 ? (
        <>Atenção agora<span className={`ax-count ${countTone ?? ''}`} title="Ao menos este número — parte da fila não foi lida por inteiro">
          {feed.total.toLocaleString('pt-BR')}+
        </span></>
      ) : 'Atenção agora'}
      count={floor ? undefined : feed.total} countTone={countTone}
      subtitle="Exceções de todas as áreas, da mais grave para a menos grave — cada linha diz por que importa e o que fazer"
      flush testId="dashboard-attention"
      bar={domains.length > 1 ? (
        <Filters label="Filtrar por área" value={active} onChange={(d) => { setDomain(d); setExpanded(false); }} options={[
          { id: 'all' as const, label: 'Tudo', count: feed.total },
          ...domains.map((d) => ({ id: d, label: DOMAIN_LABEL[d], count: feed.byDomain[d]?.total })),
        ]} />
      ) : undefined}>
      {failedText && feed.total > 0 && (
        <p className="dv2-feed-failed" role="status">
          <TriangleAlert size={14} aria-hidden />
          <span><strong>{failedText}</strong> — a fila pode estar incompleta.</span>
        </p>
      )}
      {feed.total === 0 ? (
        failedText ? (
          <EmptyState title="A fila pode estar incompleta" icon={<TriangleAlert size={18} />}
            action={onReload && (
              <button type="button" className="ax-btn sm" onClick={onReload}><RefreshCw size={13} aria-hidden />Recarregar</button>
            )}>
            {failedText}. As outras áreas que o seu perfil lê responderam sem exceção aberta.
          </EmptyState>
        ) : hasOperation === true ? (
          <EmptyState title="Nada fora do lugar" icon={<ShieldCheck size={18} />}>
            Nenhuma OS travada, atividade vencida, falta de material perto da necessidade, medição devolvida, compra parada ou
            faturamento esperando nas áreas que o seu perfil lê.
            {apex && !apex.lastRun && <> A Apex ainda não fez a primeira leitura deste inquilino.</>}
          </EmptyState>
        ) : hasOperation === false ? (
          <EmptyState title="Ainda não há operação para acompanhar" icon={<Sparkles size={18} />}
            action={<div className="dv2-empty-actions">
              <Link className="ax-btn sm primary" href="/comercial">Abrir Comercial<ArrowUpRight size={13} aria-hidden /></Link>
              <Link className="ax-btn sm" href="/operacoes/ordens-servico">Ordens de Serviço</Link>
            </div>}>
            A operação nasce de uma proposta aceita: autorização → Ordem de Serviço → projeto com cronograma. Quando o primeiro
            projeto entrar em execução, as exceções aparecem aqui.
          </EmptyState>
        ) : (
          // Não se sabe se há operação (parte restrita): diz só o que foi lido.
          <EmptyState title="Sem exceção aberta nas áreas que você lê" icon={<ShieldCheck size={18} />}>
            Nenhuma exceção aberta nas áreas que o seu perfil lê. O que o seu perfil não lê não entra nesta fila.
            {apex && !apex.lastRun && <> A Apex ainda não fez a primeira leitura deste inquilino.</>}
          </EmptyState>
        )
      ) : rows.length === 0 ? (
        // Área filtrada cujas linhas ficaram todas além do corte da fila.
        <div className="dv2-feed-empty-filter" role="status">
          <p>
            {active !== 'all' ? `${DOMAIN_LABEL[active]}: ` : ''}
            {plural(more, 'exceção', 'exceções')}{orMore}, todas além das {feed.rows.length} mais graves da fila —{' '}
            {active !== 'all'
              ? <Link href={AREA_HREF[active]}>abra {DOMAIN_LABEL[active]} para a lista completa<ArrowUpRight size={12} aria-hidden /></Link>
              : 'abra cada área para a lista completa'}.
          </p>
        </div>
      ) : (
        <>
          <ol className="dv2-feed" data-expanded={expanded ? 'true' : undefined}>
            {shown.map((r, i) => <FeedItem key={r.key} row={r} today={today} rank={i} onExplain={onExplain} />)}
          </ol>
          {(hiddenMobile > 0 || more > 0) && (
            <div className={hidden > 0 || more > 0 ? 'dv2-feed-foot' : 'dv2-feed-foot dv2-foot-mobile'}>
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
              {moreNote}
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
