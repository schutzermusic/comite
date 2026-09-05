'use client';

/**
 * Linha operacional: objeto · situação · responsável · prazo/valor · ação.
 *
 * Obrigações, faturamentos, aprovações, documentos, riscos e renovações eram
 * grades de cards. Card é bom para um objeto que você escolhe; lista é melhor
 * para objetos que você percorre — e essas seis coisas são todas percorridas.
 * A linha também deixa os campos ALINHADOS entre si, o que a grade nunca fez:
 * comparar prazos de oito obrigações exigia ler oito caixas.
 *
 * Cor comunica só estado (§19). Nada aqui é colorido por decoração, e nenhum
 * estado depende de cor sozinha: o `HudStatusPill` sempre carrega texto.
 */

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface StatusRowProps {
  /** Identificação do objeto. Texto primário da linha. */
  title: ReactNode;
  /** Contexto curto sob o título (código, contraparte, categoria). */
  meta?: ReactNode;
  /** Situação — normalmente `<HudStatusPill>`. Sempre com texto. */
  status?: ReactNode;
  /** Responsável / aprovador / dono. */
  owner?: ReactNode;
  /** Prazo ou valor, alinhado à direita e tabular. */
  trailing?: ReactNode;
  /** Ação explícita da linha. Some quando a linha inteira já é clicável. */
  action?: ReactNode;
  /** Torna a linha inteira acionável (vira `<button>`). */
  onClick?: () => void;
  className?: string;
}

export function StatusRow({
  title,
  meta,
  status,
  owner,
  trailing,
  action,
  onClick,
  className,
}: StatusRowProps) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ig-body-sm font-medium text-ig-fg-strong">{title}</p>
        {meta && <p className="mt-0.5 truncate text-ig-caption text-ig-fg-muted">{meta}</p>}
      </div>

      {status && <div className="shrink-0">{status}</div>}

      {owner && (
        <div className="hidden min-w-0 shrink-0 basis-[140px] truncate text-ig-caption text-ig-fg-muted lg:block">
          {owner}
        </div>
      )}

      {trailing && (
        <div className="ig-tabular shrink-0 text-right text-ig-body-sm text-ig-fg-strong">
          {trailing}
        </div>
      )}

      {action ? (
        <div className="shrink-0">{action}</div>
      ) : onClick ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-subtle" aria-hidden />
      ) : null}
    </>
  );

  /*
    Separador entre linhas em vez de borda por linha: a lista lê como um bloco
    contínuo, e some uma moldura por item.
  */
  const shell = cn(
    'flex w-full items-center gap-3 border-b border-ig-border-subtle px-1 py-2.5 last:border-b-0',
    className,
  );

  if (!onClick) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        shell,
        'text-left transition-colors hover:bg-ig-bg-raised/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ig-border-focus',
      )}
    >
      {body}
    </button>
  );
}
