'use client';

/**
 * Connected Operations — o contrato como objeto central conectado ao resto do
 * Insight (MD §10 do adendo).
 *
 * Cada linha mostra a relação E o seu estado atual, e leva ao módulo que é dono
 * daquele domínio. Nenhuma linha cria fonte de verdade paralela: os números vêm
 * das relações do próprio contrato, e o clique entrega o assunto a quem o
 * governa.
 *
 * Uma linha cujo estado não pôde ser apurado diz isso — não desaparece nem
 * mostra zero, que sugeriria "verificado e vazio". E uma linha cuja integração
 * não existe diz "Não integrado", que é uma afirmação sobre o produto, não
 * sobre a operação do contrato.
 *
 * ─── O que mudou no desenho ────────────────────────────────────────────────
 *
 * Onze linhas com a MESMA aparência — ícone cinza de 16px, rótulo cinza,
 * estado cinza — não comunicavam conectividade: comunicavam uma tabela. O
 * painel existe justamente para responder "o que está ligado e o que não
 * está?" à distância de um olhar, e essa resposta precisa de forma, não só de
 * texto.
 *
 * Agora o estado aparece em três lugares e nunca só em cor: no trilho de 2px
 * da linha, no contêiner do ícone e no ponto + rótulo da coluna de estado.
 * Vinculado é teal; atenção é âmbar contido; não apurado é ponto OCO em cinza
 * legível; não integrado é contorno TRACEJADO — a forma diz "sem ligação" sem
 * dizer "falhou".
 *
 * A cabeça do painel declara o contrato como raiz da relação e resume a
 * conectividade em uma linha, para que a varredura das onze linhas seja
 * opcional, não obrigatória.
 */

import { cn } from '@/lib/utils';
import {
  Workflow, Receipt, ClipboardCheck, Archive, ShieldAlert, ShieldCheck,
  ChevronRight, AlertTriangle, CalendarClock, History, Wallet, Unplug, Ruler,
  Scale, Share2,
} from 'lucide-react';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import {
  buildConnectedRows, type ConnectedContext, type ConnectedOperationKey,
  type ConnectedRow, type ConnectedTone,
} from '@/lib/contracts/trust/connected';

export type { ConnectedOperationKey, ConnectedContext };

const ICON: Record<ConnectedOperationKey, React.ReactNode> = {
  project: <Workflow className="h-4 w-4" aria-hidden />,
  tasks: <CalendarClock className="h-4 w-4" aria-hidden />,
  obligations: <ClipboardCheck className="h-4 w-4" aria-hidden />,
  measurement: <Ruler className="h-4 w-4" aria-hidden />,
  billing: <Receipt className="h-4 w-4" aria-hidden />,
  documents: <Archive className="h-4 w-4" aria-hidden />,
  risks: <ShieldAlert className="h-4 w-4" aria-hidden />,
  clauses: <Scale className="h-4 w-4" aria-hidden />,
  approvals: <ShieldCheck className="h-4 w-4" aria-hidden />,
  audit: <History className="h-4 w-4" aria-hidden />,
  finance: <Wallet className="h-4 w-4" aria-hidden />,
};

/**
 * Tom VISUAL da linha — distinto do tom semântico de `ConnectedRow`.
 *
 * `neutral` no modelo significa "apurado, sem severidade", e não "cinza":
 * "12 em conformidade" é um dado com peso de dado. Ausência de leitura (`idle`)
 * e ausência de integração (`off`) são as duas únicas linhas silenciosas, e
 * silenciosas por motivos diferentes.
 */
type RowTone = 'success' | 'warning' | 'danger' | 'measured' | 'idle' | 'off';

const TONE_OF = (row: ConnectedRow): RowTone => {
  if (row.notIntegrated) return 'off';
  if (row.errored) return 'danger';
  if (row.state === null) return 'idle';
  const semantic: Record<ConnectedTone, RowTone> = {
    success: 'success',
    warning: 'warning',
    danger: 'danger',
    neutral: 'measured',
  };
  return semantic[row.tone];
};

/** O contêiner do ícone só se tinge quando há algo a dizer. */
const GLYPH_TONE: Record<RowTone, string> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  measured: 'idle',
  idle: 'idle',
  off: 'off',
};

export interface ConnectedOperationsProps {
  contract: TrustedContract;
  /** Contagens vindas dos módulos donos (Agenda, Auditoria). */
  context?: ConnectedContext;
  onNavigate?: (key: ConnectedOperationKey) => void;
  className?: string;
}

export function ConnectedOperations({
  contract, context, onNavigate, className,
}: ConnectedOperationsProps) {
  const rows = buildConnectedRows(contract, context);

  /*
    O resumo conta o que a varredura contaria, e conta com as MESMAS regras do
    tom de cada linha — um total que discordasse das linhas abaixo dele seria
    pior do que nenhum total.
  */
  const tones = rows.map(TONE_OF);
  const linked = tones.filter((t) => t === 'success' || t === 'measured').length;
  const attention = tones.filter((t) => t === 'warning' || t === 'danger').length;
  const detached = tones.filter((t) => t === 'off').length;

  return (
    <section className={cn('ig-lp', className)} aria-labelledby="ig-connected-title">
      <header className="ig-lp-head flex items-start gap-3 px-4 pb-3 pt-4 sm:px-5">
        <span className="ig-lp-mark" aria-hidden>
          <Share2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="ig-connected-title" className="text-ig-body-sm font-semibold text-ig-fg-strong">
            Operações conectadas
          </h3>
          <p className="mt-0.5 text-ig-caption leading-relaxed text-ig-fg-muted">
            Relações operacionais · acesse o módulo responsável.
          </p>
        </div>
      </header>

      {/* ── Régua de conectividade ───────────────────────────────────── */}
      <div className="ig-lp-rule flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2 sm:px-5">
        <Tally value={linked} label={linked === 1 ? 'conectada' : 'conectadas'} tone="accent" />
        {attention > 0 && <Tally value={attention} label="em atenção" tone="warning" />}
        {detached > 0 && (
          <Tally
            value={detached}
            label={detached === 1 ? 'não integrada' : 'não integradas'}
            tone="off"
          />
        )}
        <span className="ig-tabular ml-auto text-ig-caption text-ig-fg-muted">
          {rows.length} relações
        </span>
      </div>

      <div className="dossier-connection-root mx-4 mt-3"><Share2 className="h-3.5 w-3.5" aria-hidden />Contrato · {contract.code}</div>
      <ul className="dossier-connections px-1.5 py-1.5">
        {rows.map((row) => (
          <ConnectedOperationRow key={row.key} row={row} onNavigate={onNavigate} />
        ))}
      </ul>
    </section>
  );
}

function Tally({
  value, label, tone,
}: { value: number; label: string; tone: 'accent' | 'warning' | 'off' }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className={cn(
          'ig-tabular text-ig-body-sm font-semibold',
          tone === 'accent' ? 'text-ig-accent'
            : tone === 'warning' ? 'text-ig-warning'
              : 'text-ig-fg-muted',
        )}
      >
        {value}
      </span>
      <span className="text-ig-caption text-ig-fg-muted">{label}</span>
    </span>
  );
}

function ConnectedOperationRow({
  row, onNavigate,
}: { row: ConnectedRow; onNavigate?: (key: ConnectedOperationKey) => void }) {
  /* Um módulo que não existe no produto não tem para onde navegar. */
  const interactive = Boolean(onNavigate) && !row.notIntegrated;
  const tone = TONE_OF(row);
  const Comp: React.ElementType = interactive ? 'button' : 'div';

  return (
    <li
      className="ig-lp-row"
      data-tone={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : undefined}
      data-interactive={interactive ? 'true' : undefined}
    >
      <Comp
        type={interactive ? 'button' : undefined}
        onClick={interactive ? () => onNavigate?.(row.key) : undefined}
        title={row.note ?? undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-[9px] px-3 py-2.5 text-left',
          interactive && 'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ig-border-focus',
        )}
      >
        <span className="ig-lp-glyph" data-tone={GLYPH_TONE[tone]} aria-hidden>
          {ICON[row.key]}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ig-body-sm font-medium text-ig-fg-strong">{row.label}</span>
          {/*
            O módulo dono, para que ninguém confunda leitura com posse do dado —
            e só quando ele acrescenta informação. "Riscos / Riscos" é ruído.
          */}
          {row.owner !== 'Contratos' && !row.owner.startsWith(row.label) && (
            <span className="truncate text-ig-label text-ig-fg-muted">{row.owner}</span>
          )}
        </span>

        {/*
          Coluna de estado de largura fixa. Sem ela cada linha põe o estado num
          x diferente e a varredura vertical — o uso real do painel — some.
        */}
        {row.notIntegrated ? (
          <span className="ig-lp-state w-[104px] text-ig-caption font-medium" data-tone="off">
            <Unplug className="h-3 w-3 shrink-0" aria-hidden />
            Não integrado
          </span>
        ) : row.errored ? (
          <span className="ig-lp-state w-[104px] text-ig-caption font-semibold" data-tone="danger">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            Indisponível
          </span>
        ) : row.state === null ? (
          <span className="ig-lp-state w-[104px] text-ig-caption font-medium" data-tone="idle">
            <i aria-hidden />
            Não apurado
          </span>
        ) : (
          <span
            className="ig-lp-state min-w-[104px] max-w-[210px] text-ig-caption"
            data-tone={tone}
            title={row.state}
          >
            <i aria-hidden />
            <span>{row.state}</span>
          </span>
        )}

        {interactive && (
          <ChevronRight className="ig-lp-go h-3.5 w-3.5 shrink-0" aria-hidden />
        )}
      </Comp>
    </li>
  );
}
