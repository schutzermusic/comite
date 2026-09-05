'use client';

/**
 * Aviso de origem do recorte operacional.
 *
 * As abas operacionais (renovações, obrigações, faturamento, aprovações,
 * riscos) respeitam o escopo que o usuário escolheu — inclusive quando ele
 * escolhe ver demonstração. Esconder o que ele pediu para ver contraria a regra
 * que vale desde a fase de classificação: demonstração não se esconde, se
 * rotula.
 *
 * O que NÃO muda com o escopo é a métrica oficial da empresa: a Executive Band
 * e os PDFs seguem contando apenas `live`, com a fronteira aplicada dentro do
 * agregador. Este aviso existe para que ninguém confunda uma coisa com a outra
 * ao olhar uma soma de dinheiro numa aba operacional.
 *
 * ─── Uma vez, não cinco ───────────────────────────────────────────────────
 *
 * Este aviso era renderizado IDENTICAMENTE em cinco abas (renovações,
 * obrigações, faturamento, aprovações, riscos). O mesmo parágrafo de três
 * linhas reaparecia a cada troca de aba, sempre dizendo a mesma coisa — e um
 * aviso que se repete assim para de ser lido, que é o pior desfecho possível
 * para um aviso de fronteira de dados.
 *
 * Agora é UM indicador compacto e persistente junto ao cabeçalho da página. Ele
 * não some ao trocar de aba: fica visível o tempo todo, do lado do título, o
 * que é mais difícil de ignorar do que um bloco que o olho já aprendeu a pular.
 * A distinção continua impossível de confundir — tom de atenção, ícone próprio,
 * contagem explícita — e a métrica oficial segue protegida no agregador, não
 * aqui.
 */

import { cn } from '@/lib/utils';
import { FlaskConical } from 'lucide-react';
import type { ContractDataClass } from '@/lib/contracts/trust/trusted';

export interface ScopeOriginNoticeProps {
  /** Origem de cada contrato do recorte atual. */
  dataClasses: readonly ContractDataClass[];
  className?: string;
  /**
   * Indicador de uma linha, para o cabeçalho da página. A justificativa
   * completa passa a viver no `title` — presente para quem precisa dela,
   * silenciosa para quem já a leu.
   */
  compact?: boolean;
}

export function ScopeOriginNotice({ dataClasses, className, compact = false }: ScopeOriginNoticeProps) {
  const demo = dataClasses.filter((c) => c === 'demo').length;
  const unclassified = dataClasses.filter((c) => c === 'unclassified').length;
  if (demo === 0 && unclassified === 0) return null;

  const parts = [
    demo > 0 ? `${demo} de demonstração` : null,
    unclassified > 0 ? `${unclassified} de origem não validada` : null,
  ].filter(Boolean).join(' e ');

  const rationale =
    'Os números das abas operacionais descrevem o recorte selecionado — não a carteira oficial da empresa, que segue contando apenas contratos de origem validada.';

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-ig-warning/35',
          'bg-[color-mix(in_oklab,var(--ig-warning)_6%,transparent)] px-2.5 py-1',
          'text-[11px] font-medium text-ig-fg-muted',
          className,
        )}
        role="note"
        title={rationale}
      >
        <FlaskConical className="h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
        <span>
          Recorte inclui <span className="font-semibold text-ig-fg-strong">{parts}</span>
        </span>
      </span>
    );
  }

  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-[12px] border border-ig-warning/35',
        'bg-[color-mix(in_oklab,var(--ig-warning)_5%,transparent)] px-3 py-2',
        'text-ig-caption text-ig-fg-muted',
        className,
      )}
      role="note"
    >
      <FlaskConical className="mt-px h-3.5 w-3.5 shrink-0 text-ig-warning" aria-hidden />
      <span>
        Este recorte inclui <span className="font-semibold text-ig-fg-strong">{parts}</span>. {rationale}
      </span>
    </p>
  );
}
