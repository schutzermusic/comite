'use client';

/**
 * O que o recorte deixou de saber.
 *
 * Aparece só quando um filtro custou algum indicador. Um traço num KPI sem
 * explicação é indistinguível de "esse número não existe" — e o usuário que
 * acabou de filtrar por lotação merece saber que foi o filtro dele que
 * derrubou Folha/Receita, não uma falha de integração.
 */

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Degradation } from '@/lib/workforce/overview/types';

interface WorkforceScopeNoticeProps {
  degradations: Degradation[];
  className?: string;
}

export function WorkforceScopeNotice({ degradations, className }: WorkforceScopeNoticeProps) {
  if (degradations.length === 0) return null;

  return (
    <div
      className={cn(
        'rounded-xl border border-ig-info/25 bg-ig-info/[0.05] px-4 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-ig-info" />
        <div className="min-w-0 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ig-fg-muted">
            Alcance deste recorte
          </p>
          <ul className="space-y-1">
            {degradations.map((d) => (
              <li key={d.field} className="text-[11.5px] leading-relaxed text-ig-fg-muted">
                {d.humanLabel}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
