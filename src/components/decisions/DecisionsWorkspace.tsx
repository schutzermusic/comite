'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import {
  AxPage, CommandHeader, Dot, EmptyState, ErrorState, Filters, KV, Plane, SignalStrip, Skeleton, Tabs, date, relativeDue,
  useResource, useUrlParam, useUrlParams,
} from '@/components/ax';
import type { DecisionsTab, DecisionsWorkspace as WorkspaceData } from '@/lib/decisions/types';
import { Bottlenecks, CompletedRow, DecisionRow, TeamRow } from './DecisionRows';
import { DecisionPanel } from './DecisionPanel';
import { DecisionsIdle } from './DecisionsIdle';
import {
  ALL_CATEGORIES, SCOPE_LABEL, amountText, byCategory, categoryOptions, contextParts, mineSummary, mineView, normalizeFilter,
  normalizeTab, signalCounts, sortBottlenecks, tabsFor, type MineFilter,
} from './view';
import './decisions.css';

type Payload = WorkspaceData & { ok: true };

/**
 * DECISÕES — "o que precisa de mim agora?".
 *
 * Uma PROJEÇÃO: cada item é a decisão canônica (etapa do Motor de Aprovação
 * ou pedido de compra sob alçada declarada) lida na hora pelo servidor, já
 * na ordem da fila — vencidas, impacto crítico, prazo, valor, demais. Esta
 * tela não guarda estado de decisão e não decide sozinha o que a pessoa pode
 * fazer: mostra, explica e leva ao ato que a própria origem executa.
 *
 * Estado endereçável: ?tab= (minhas|equipe|concluidas), ?f= (atalho da
 * faixa de sinais), ?cat= (categoria) e ?d= (decisão aberta) — o link de
 * uma notificação cai direto no detalhe.
 */
export function DecisionsWorkspace() {
  return (
    <AxPage testId="decisions-workspace">
      <Workspace />
    </AxPage>
  );
}

function Workspace() {
  const [rawTab] = useUrlParam<string>('tab', 'minhas');
  const [openKey] = useUrlParam<string>('d', '');
  const [rawCat] = useUrlParam<string>('cat', ALL_CATEGORIES);
  const [rawFilter] = useUrlParam<string>('f', 'todos');
  const patch = useUrlParams();
  const requested = normalizeTab(rawTab);
  const res = useResource<Payload>(`/api/decisions?tab=${requested}`);

  // A última leitura boa segura o cabeçalho e as abas enquanto outra aba
  // carrega: trocar de aba não apaga a tela nem tira o foco da aba.
  const [frame, setFrame] = useState<Payload | null>(null);
  if (res.data && res.data !== frame) setFrame(res.data);
  const ws = res.data ?? frame;

  /*
    Abrir uma decisão ENTRA no histórico: no celular o detalhe é uma tela
    cheia, e o "voltar" do aparelho tem de fechá-la — não sair de Decisões.
    Fechar volta no histórico quando fomos nós que abrimos; aberto por link
    (e-mail, aviso), só troca o endereço.
  */
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const pushed = useRef(false);
  useEffect(() => { if (!openKey) pushed.current = false; }, [openKey]);
  const openDecision = (key: string) => {
    const q = new URLSearchParams(search.toString()); q.set('d', key);
    pushed.current = true;
    router.push(`${pathname}?${q.toString()}`, { scroll: false });
  };
  const closeDecision = () => {
    if (pushed.current) { pushed.current = false; router.back(); } else patch({ d: null });
  };
  const panel = openKey ? <DecisionPanel key={openKey} decisionKey={openKey} onClose={closeDecision} /> : null;

  if (!ws) {
    return (
      <>
        {res.state === 'loading' ? <Skeleton /> : <ErrorState message={res.message} onRetry={res.refresh} />}
        {panel}
      </>
    );
  }

  const tab = normalizeTab(requested, ws.teamScope);
  const f = normalizeFilter(rawFilter);
  const cat = rawCat || ALL_CATEGORIES;
  const s = signalCounts(ws);
  // Sucesso com ZERO decisões (nem na sua faixa, nem sob sua alçada): estado
  // próprio, calmo — não erro, não fila vazia genérica. Falha é o ErrorState.
  const idle = ws.mine.length === 0 && ws.alsoEligible.length === 0;
  const go = (next: { tab?: DecisionsTab; f?: MineFilter }) =>
    patch({ tab: next.tab && next.tab !== 'minhas' ? next.tab : null, f: next.f && next.f !== 'todos' ? next.f : null });
  const setCat = (id: string) => patch({ cat: id === ALL_CATEGORIES ? null : id });
  const clearFilters = () => patch({ f: null, cat: null });

  let body: ReactNode;
  if (!res.data) body = res.state === 'loading' ? <Skeleton /> : <ErrorState message={res.message} onRetry={res.refresh} />;
  else if (tab === 'equipe') body = <TeamTab ws={res.data} cat={cat} openKey={openKey} onOpen={openDecision} onCategory={setCat} onClear={clearFilters} />;
  else if (tab === 'concluidas') body = <CompletedTab ws={res.data} cat={cat} openKey={openKey} onOpen={openDecision} onCategory={setCat} onClear={clearFilters} />;
  else body = <MineTab ws={res.data} f={f} cat={cat} openKey={openKey} onOpen={openDecision} onFilter={(x) => go({ f: x })} onCategory={setCat} onClear={clearFilters} />;

  return (
    <>
      <CommandHeader eyebrow={<b>Decisões</b>} title="O que precisa de você"
        context={<>
          {idle
            ? <span>Situações que exigem sua autoridade, julgamento ou exceção.</span>
            : contextParts(ws.counts).map((p) => (
              <span key={p.text}>{p.tone && <Dot tone={p.tone} label="vencida" />}<strong>{p.text}</strong></span>
            ))}
          <span>Hoje, {date(ws.today)}</span>
        </>} />

      {!idle && <div className="dec-signals">
      <SignalStrip label="Sinais de Decisões" items={[
        { label: 'Aguardando você', value: s.waiting.toLocaleString('pt-BR'), hint: 'suas e escaladas para você',
          tone: s.waiting ? 'warning' : undefined, onClick: () => go({ f: 'todos' }), testId: 'decisions-signal-waiting' },
        { label: 'Vencidas', value: s.overdue.toLocaleString('pt-BR'), hint: 'o prazo de decisão passou',
          tone: s.overdue ? 'danger' : undefined, onClick: () => go({ f: 'vencidas' }), testId: 'decisions-signal-overdue' },
        { label: 'Escaladas para você', value: s.escalated.toLocaleString('pt-BR'), hint: 'venceram na faixa primária',
          tone: s.escalated ? 'warning' : undefined, onClick: () => go({ f: 'escaladas' }), testId: 'decisions-signal-escalated' },
        { label: 'Sob sua alçada', value: s.eligible.toLocaleString('pt-BR'), hint: 'você pode decidir; a faixa é outra',
          onClick: () => go({ f: 'alcada' }), testId: 'decisions-signal-eligible' },
      ]} />
      </div>}

      <Tabs label="Decisões" tabs={tabsFor(ws)} value={tab} onChange={(id) => go({ tab: id })} />
      <div className="dec-tabpanel" role="tabpanel" aria-labelledby={`ax-tab-${tab}`} aria-busy={!res.data || undefined} data-testid={`decisions-tab-${tab}`}>
        {body}
      </div>
      {panel}
    </>
  );
}

// ---------------------------------------------------------------------------
// Minhas
// ---------------------------------------------------------------------------

function MineTab({ ws, f, cat, openKey, onOpen, onFilter, onCategory, onClear }: {
  ws: Payload; f: MineFilter; cat: string; openKey: string; onOpen: (key: string) => void;
  onFilter: (f: MineFilter) => void; onCategory: (id: string) => void; onClear: () => void;
}) {
  const base = mineView(ws, f, ALL_CATEGORIES);
  const view = mineView(ws, f, cat);
  const options = categoryOptions(ws.categories, [...base.items, ...base.eligible], cat);
  const overdue = view.items.filter((i) => i.overdue).length;
  const nothingPending = f === 'todos' && ws.mine.length === 0;
  const sum = mineSummary(ws.mine);
  if (ws.mine.length === 0 && ws.alsoEligible.length === 0) {
    return (
      <div className="ax-stack">
        <DecisionsIdle ws={ws} openKey={openKey} onOpen={onOpen} />
        <p className="ax-note">
          <ShieldCheck size={13} aria-hidden />
          Cada decisão é lida na hora da origem — Motor de Aprovação ou alçada de compra declarada. O ato feito aqui é o mesmo da
          origem, com a mesma regra: quem solicitou não aprova, e nada é decidido fora da sua alçada.
        </p>
      </div>
    );
  }
  return (
    <div className="ax-grid main-side">
      <div className="ax-stack">
        <Plane title={view.title} count={view.items.length} countTone={overdue ? 'danger' : undefined} subtitle={view.subtitle} flush
          testId="decisions-mine"
          action={f !== 'todos' ? <button type="button" className="ax-btn ghost sm" onClick={() => onFilter('todos')}>Ver toda a fila</button> : undefined}
          bar={options.length > 1 ? <Filters label="Filtrar por categoria" value={cat} onChange={onCategory} options={options} /> : undefined}>
          {view.items.length > 0 ? (
            <ol className="dec-list" aria-label={view.title}>
              {view.items.map((item) => (
                <DecisionRow key={item.key} item={item} today={ws.today} current={item.key === openKey} onOpen={onOpen}
                  variant={f === 'alcada' ? 'eligible' : 'mine'} />
              ))}
            </ol>
          ) : nothingPending ? (
            <EmptyState title="Nenhuma decisão pendente." icon={<ShieldCheck size={18} />}>
              O Apex mostrará aqui situações que exigem sua autoridade ou julgamento.
            </EmptyState>
          ) : (
            <EmptyState title={view.emptyTitle} compact
              action={<button type="button" className="ax-btn sm" onClick={onClear}>Limpar filtros</button>}>
              {view.emptyText}
            </EmptyState>
          )}
        </Plane>

        {view.eligible.length > 0 && (
          <details className="ax-plane dec-eligible" data-testid="decisions-also-eligible">
            {/* <summary> aceita título + texto corrido (não <p>/<div>): a grade do CSS faz o layout. */}
            <summary>
              <h3>Também sob sua alçada <span className="ax-count">{view.eligible.length}</span></h3>
              <span className="dec-eligible-sub">Você tem alçada para decidir, mas a decisão é de outra faixa.</span>
              <ChevronDown size={16} className="dec-chevron" aria-hidden />
            </summary>
            <ol className="dec-list" aria-label="Também sob sua alçada">
              {view.eligible.map((item) => (
                <DecisionRow key={item.key} item={item} today={ws.today} current={item.key === openKey} onOpen={onOpen} variant="eligible" />
              ))}
            </ol>
          </details>
        )}
      </div>

      <div className="ax-stack">
        {ws.mine.length > 0 && (
          <Plane title="Em jogo" subtitle="Só o que está na sua fila, somado como veio da origem" testId="decisions-summary">
            <KV items={[
              ['Valor aguardando você', sum.totals.length ? sum.totals.map((t) => amountText(t.amount, t.currency)).join(' + ') : 'Sem valor declarado'],
              ['Próximo prazo', sum.nextDeadline ? `${date(sum.nextDeadline)} · ${relativeDue(sum.nextDeadline, ws.today).text}` : 'Sem prazo declarado'],
              ['Mais antiga', sum.oldestRequest ? `solicitada ${relativeDue(sum.oldestRequest, ws.today).text}` : '—'],
              ['Projetos envolvidos', sum.projects ? sum.projects.toLocaleString('pt-BR') : '—'],
            ]} />
          </Plane>
        )}
        <p className="ax-note">
          <ShieldCheck size={13} aria-hidden />
          Cada item é lido na hora da decisão de origem — Motor de Aprovação ou alçada de compra declarada. O ato feito aqui é o
          mesmo da origem, com a mesma regra: quem solicitou não aprova, e nada é decidido fora da sua alçada.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equipe
// ---------------------------------------------------------------------------

function TeamTab({ ws, cat, openKey, onOpen, onCategory, onClear }: {
  ws: Payload; cat: string; openKey: string; onOpen: (key: string) => void; onCategory: (id: string) => void; onClear: () => void;
}) {
  const team = ws.team;
  if (!team || team.scope === 'NONE') {
    return (
      <Plane flush>
        <EmptyState title="Sem visão de equipe.">A visão das decisões da equipe depende de permissão. Suas decisões estão em “Minhas”.</EmptyState>
      </Plane>
    );
  }
  const items = byCategory(team.items, cat);
  const options = categoryOptions(ws.categories, team.items, cat);
  const overdue = items.filter((i) => i.overdue).length;
  return (
    <>
      <Plane title="Onde as decisões param" subtitle={`${SCOPE_LABEL[team.scope]} · por quem tem a decisão`} flush testId="decisions-bottlenecks">
        {team.bottlenecks.length > 0
          ? <Bottlenecks list={sortBottlenecks(team.bottlenecks)} />
          : <EmptyState compact title="Nada parado.">Nenhuma decisão pendente na equipe neste momento.</EmptyState>}
      </Plane>
      <Plane title="Pendentes na equipe" count={items.length} countTone={overdue ? 'danger' : undefined} flush testId="decisions-team"
        subtitle="Com quem está, há quanto tempo e até quando — o valor que você não pode ver aparece como “Restrito”"
        bar={options.length > 1 ? <Filters label="Filtrar por categoria" value={cat} onChange={onCategory} options={options} /> : undefined}>
        {items.length > 0 ? (
          <ol className="dec-list" aria-label="Pendentes na equipe">
            {items.map((item) => <TeamRow key={item.key} item={item} current={item.key === openKey} onOpen={onOpen} />)}
          </ol>
        ) : team.items.length > 0 ? (
          <EmptyState compact title="Nenhuma decisão neste filtro."
            action={<button type="button" className="ax-btn sm" onClick={onClear}>Limpar filtros</button>}>
            Limpe o filtro para ver todas as pendentes da equipe.
          </EmptyState>
        ) : (
          <EmptyState title="Nenhuma decisão pendente na equipe.">Quando alguém da equipe tiver uma decisão aberta, ela aparece aqui.</EmptyState>
        )}
      </Plane>
    </>
  );
}

// ---------------------------------------------------------------------------
// Concluídas
// ---------------------------------------------------------------------------

function CompletedTab({ ws, cat, openKey, onOpen, onCategory, onClear }: {
  ws: Payload; cat: string; openKey: string; onOpen: (key: string) => void; onCategory: (id: string) => void; onClear: () => void;
}) {
  const all = ws.completed ?? [];
  const items = byCategory(all, cat);
  const options = categoryOptions(ws.categories, all, cat);
  return (
    <Plane title="Concluídas" count={items.length} flush testId="decisions-completed"
      subtitle="O que você decidiu ou solicitou — quem decidiu, quando, por quê e sob que alçada"
      bar={options.length > 1 ? <Filters label="Filtrar por categoria" value={cat} onChange={onCategory} options={options} /> : undefined}>
      {items.length > 0 ? (
        <ol className="dec-list" aria-label="Decisões concluídas">
          {items.map((item) => <CompletedRow key={item.key} item={item} current={item.key === openKey} onOpen={onOpen} />)}
        </ol>
      ) : all.length > 0 ? (
        <EmptyState compact title="Nenhuma decisão neste filtro."
          action={<button type="button" className="ax-btn sm" onClick={onClear}>Limpar filtros</button>}>
          Limpe o filtro para ver todas as concluídas.
        </EmptyState>
      ) : (
        <EmptyState title="Nenhuma decisão concluída.">
          As decisões que você tomar ou solicitar aparecem aqui, com quem decidiu, quando e por quê.
        </EmptyState>
      )}
    </Plane>
  );
}
