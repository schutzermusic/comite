'use client';

/**
 * Operações conectadas no nível da carteira.
 *
 * Torna visível que o contrato é o objeto central da operação:
 *
 *   Contrato → Projeto → Obrigação → Medição → Faturamento → Financeiro
 *            → Risco → Aprovação → Auditoria
 *
 * Cada linha responde três coisas — estado atual, se aquele estado é apurado, e
 * para onde ir. Nenhuma conexão decorativa: um "Financeiro ✓" que não diz nada
 * e não leva a lugar nenhum ocupa atenção e devolve zero, então o módulo não
 * integrado é declarado como tal, com o motivo.
 *
 * ─── Desenho ───────────────────────────────────────────────────────────────
 *
 * A "espinha" — nó, linha vertical, cotovelos e pontos por banda — era ilustração
 * de uma hierarquia que os rótulos já diziam, e pintava seis elementos
 * decorativos numa coluna estreita. Saiu inteira.
 *
 * Ficou um TRILHO DE INTEGRAÇÃO com três agrupamentos — Ativos, Aguardando
 * dados, Não integrado — cada um com a sua contagem na cabeceira e uma linha
 * por módulo: ícone · nome · medida.
 *
 * Nem todo módulo pesa igual, e a ponta direita da linha carrega MEDIDA, não
 * rótulo de estado. Antes toda linha terminava numa cápsula — inclusive as que
 * só sabiam dizer "NÃO APURADO" —, e a coluna virava uma pilha de caixinhas
 * cinza com mais peso visual que os módulos que de fato tinham número. Quando
 * há medida, ela aparece em texto tabular; quando não há, a linha não termina
 * em nada, porque o agrupamento já disse o estado. Severidade real (atenção,
 * crítico) continua marcada — aí o Signal inline acende, porque aí informa.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  Workflow, Wallet, Receipt, ClipboardCheck, Archive, ShieldAlert,
  ShieldCheck, CalendarClock, History, ArrowUpRight, Unplug,
} from 'lucide-react';
import { HudSignal, type HudSignalTone } from '@/components/hud';
import type { ModuleConnection, ModuleKey, ModuleLinkState } from '@/lib/contracts/trust/command-center';

const ICON: Record<ModuleKey, React.ReactNode> = {
  projetos: <Workflow className="h-3.5 w-3.5" aria-hidden />,
  financeiro: <Wallet className="h-3.5 w-3.5" aria-hidden />,
  faturamento: <Receipt className="h-3.5 w-3.5" aria-hidden />,
  obrigacoes: <ClipboardCheck className="h-3.5 w-3.5" aria-hidden />,
  documentos: <Archive className="h-3.5 w-3.5" aria-hidden />,
  riscos: <ShieldAlert className="h-3.5 w-3.5" aria-hidden />,
  aprovacoes: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
  tarefas: <CalendarClock className="h-3.5 w-3.5" aria-hidden />,
  auditoria: <History className="h-3.5 w-3.5" aria-hidden />,
};

const STATE: Record<ModuleLinkState, { tone: HudSignalTone; label: string; text: string }> = {
  healthy: { tone: 'success', label: 'Regular', text: 'text-ig-success' },
  attention: { tone: 'warning', label: 'Atenção', text: 'text-ig-warning' },
  critical: { tone: 'critical', label: 'Crítico', text: 'text-ig-danger' },
  unmeasured: { tone: 'neutral', label: 'Não apurado', text: 'text-ig-fg-subtle' },
  'not-integrated': { tone: 'neutral', label: 'Não integrado', text: 'text-ig-fg-subtle' },
};

export interface ModuleConnectionsProps {
  connections: readonly ModuleConnection[];
  onNavigate?: (key: ModuleKey) => void;
  className?: string;
}

export function ModuleConnections({ connections, onNavigate, className }: ModuleConnectionsProps) {
  const operating = connections.filter(
    (c) => c.state === 'healthy' || c.state === 'attention' || c.state === 'critical',
  );
  const awaiting = connections.filter((c) => c.state === 'unmeasured');
  const detached = connections.filter((c) => c.state === 'not-integrated');

  return (
    <div className={cn('space-y-2.5', className)}>
      {operating.length > 0 && (
        <Band label="Ativos" count={operating.length} tone="success">
          <ul>
            {operating.map((conn) => (
              <ConnectionRow key={conn.key} connection={conn} onNavigate={onNavigate} />
            ))}
          </ul>
        </Band>
      )}

      {awaiting.length > 0 && (
        <Band label="Aguardando dados" count={awaiting.length}>
          <ul>
            {awaiting.map((conn) => (
              <ConnectionRow key={conn.key} connection={conn} onNavigate={onNavigate} />
            ))}
          </ul>
        </Band>
      )}

      {/*
        Não integrado fecha a lista como TEXTO, não como linhas clicáveis: não
        há para onde ir, e desenhar uma linha navegável que não navega é pior
        que uma frase honesta.
      */}
      {detached.length > 0 && (
        <Band label="Não integrado" count={detached.length}>
          <ul className="space-y-0.5 pt-0.5">
            {detached.map((conn) => (
              <li key={conn.key} className="flex items-baseline gap-1.5 px-2 text-ig-caption text-ig-fg-subtle">
                <Unplug className="translate-y-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span className="shrink-0 font-medium">{conn.label}</span>
                {conn.note && <span className="min-w-0 truncate" title={conn.note}>— {conn.note}</span>}
              </li>
            ))}
          </ul>
        </Band>
      )}
    </div>
  );
}

/** Cabeceira de agrupamento: Signal inline com a contagem, e um fio. */
function Band({ label, count, tone = 'neutral', children }: {
  label: string; count: number; tone?: HudSignalTone; children: React.ReactNode;
}) {
  return (
    <section>
      <header className="mb-0.5 flex items-center gap-2">
        <HudSignal variant="inline" size="sm" tone={tone} label={label} value={count} />
        <span className="h-px flex-1 bg-ig-border-subtle" aria-hidden />
      </header>
      {children}
    </section>
  );
}

/**
 * Uma linha por módulo, numa régua só: ícone · nome + detalhe · métrica ·
 * estado. Eram nove ladrilhos com borda e raio dentro de uma seção que já tem
 * moldura — nove objetos onde há uma lista.
 */
function ConnectionRow({
  connection: c, onNavigate,
}: {
  connection: ModuleConnection; onNavigate?: (key: ModuleKey) => void;
}) {
  const s = STATE[c.state];
  const interactive = Boolean(c.href || onNavigate);
  const alerting = c.state === 'attention' || c.state === 'critical';

  const inner = (
    <>
      <span className="shrink-0 text-ig-fg-subtle transition-colors group-hover:text-ig-accent">{ICON[c.key]}</span>

      {/*
        Nome e detalhe na MESMA linha. O detalhe ocupava uma segunda altura por
        módulo, e nove módulos viravam dezoito linhas numa coluna de apoio.
      */}
      <span className="min-w-0 flex-1 truncate text-ig-caption text-ig-fg-strong">
        {c.label}
        {(c.detail || c.note) && (
          <span className="ml-1.5 font-normal text-ig-fg-subtle" title={c.detail ?? c.note ?? undefined}>
            {c.detail ?? c.note}
          </span>
        )}
      </span>

      {c.headline ? (
        <span className={cn('ig-tabular shrink-0 text-ig-caption font-semibold', alerting ? s.text : 'text-ig-fg-strong')}>
          {c.headline}
        </span>
      ) : alerting ? (
        <HudSignal variant="inline" size="sm" tone={s.tone} label={s.label} className="shrink-0" />
      ) : null}

      {interactive && (
        <ArrowUpRight
          className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
      )}
    </>
  );

  const cls = cn(
    'group flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2 pr-1.5 text-left',
    interactive && [
      'ig-row-hover cursor-pointer',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
    ],
  );

  return (
    <li>
      {c.href ? (
        <Link href={c.href} className={cls}>{inner}</Link>
      ) : onNavigate ? (
        <button type="button" onClick={() => onNavigate(c.key)} className={cls}>{inner}</button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}
