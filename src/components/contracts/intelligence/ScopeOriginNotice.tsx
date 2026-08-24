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
 */

import { cn } from '@/lib/utils';
import { FlaskConical } from 'lucide-react';
import type { ContractDataClass } from '@/lib/contracts/trust/trusted';

export interface ScopeOriginNoticeProps {
  /** Origem de cada contrato do recorte atual. */
  dataClasses: readonly ContractDataClass[];
  className?: string;
}

export function ScopeOriginNotice({ dataClasses, className }: ScopeOriginNoticeProps) {
  const demo = dataClasses.filter((c) => c === 'demo').length;
  const unclassified = dataClasses.filter((c) => c === 'unclassified').length;
  if (demo === 0 && unclassified === 0) return null;

  const parts = [
    demo > 0 ? `${demo} de demonstração` : null,
    unclassified > 0 ? `${unclassified} de origem não validada` : null,
  ].filter(Boolean).join(' e ');

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
        Este recorte inclui <span className="font-semibold text-ig-fg-strong">{parts}</span>.
        Os números abaixo descrevem o que está selecionado — não a carteira oficial da empresa,
        que segue contando apenas contratos de origem validada.
      </span>
    </p>
  );
}
