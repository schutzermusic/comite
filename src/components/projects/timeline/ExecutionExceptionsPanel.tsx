'use client';

/**
 * Fila de EXCEÇÕES de execução — o inverso do "83 atividades para atualizar".
 *
 * A promessa do P2 é que o gestor só seja chamado quando a máquina não
 * conseguiu decidir sozinha. Este painel é onde isso aparece: cada linha é uma
 * decisão que exige um humano, com a evidência e a razão à vista.
 *
 * Não há tabela de exceções — tudo é derivado em leitura de
 * `execution-derivation.ts`. Resolver uma exceção significa agir na FONTE
 * (escolher a etapa, corrigir o progresso), não marcar uma caixinha aqui.
 */

import React, { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { HudPanel } from '@/components/hud';
import { SignalChip, type SignalChipTone } from '@/components/ui/signal-chip';
import type { ExecutionException, ExceptionSeverity } from '@/lib/projects/execution-derivation';

const SEVERITY_TONE: Record<ExceptionSeverity, SignalChipTone> = {
  high: 'critical',
  medium: 'warning',
  low: 'neutral',
};

const SEVERITY_LABEL: Record<ExceptionSeverity, string> = {
  high: 'Decidir',
  medium: 'Revisar',
  low: 'Observar',
};

export interface ExecutionExceptionsPanelProps {
  exceptions: ExecutionException[];
  onSelectItem: (itemId: string) => void;
  /** Mostradas antes do "ver todas". Mantém o painel compacto. */
  previewCount?: number;
}

export function ExecutionExceptionsPanel({
  exceptions,
  onSelectItem,
  previewCount = 5,
}: ExecutionExceptionsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  // Nada pendente é uma notícia boa e merece uma linha, não um painel vazio.
  if (exceptions.length === 0) {
    return (
      <p className="flex items-center gap-1.5 px-1 text-[11px] text-ig-fg-subtle">
        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
        Nenhuma exceção de execução pendente.
      </p>
    );
  }

  const shown = expanded ? exceptions : exceptions.slice(0, previewCount);
  const decisions = exceptions.filter((e) => e.severity === 'high').length;

  return (
    <HudPanel
      title={
        exceptions.length === 1
          ? '1 exceção requer sua decisão'
          : `${exceptions.length} exceções requerem sua decisão`
      }
      subtitle={
        decisions > 0
          ? `${decisions} de alta prioridade · derivadas da evidência operacional`
          : 'Derivadas da evidência operacional'
      }
      icon={<ShieldAlert className="h-4 w-4" />}
      elevation={1}
      state={decisions > 0 ? 'critical' : 'warning'}
      noPadding
    >
      {/*
        As candidatas são botões IRMÃOS do título, não filhos. `<button>` não
        pode conter elemento interativo: aninhar quebra o HTML e o navegador
        resolve isso de forma imprevisível.
      */}
      <ul className="divide-y divide-ig-border-subtle">
        {shown.map((ex) => (
          <li key={ex.id} className="px-4 py-2">
            <div className="flex items-start gap-3">
              <SignalChip size="xs" tone={SEVERITY_TONE[ex.severity]} label={SEVERITY_LABEL[ex.severity]} />
              <div className="min-w-0 flex-1">
                {ex.itemId ? (
                  <button
                    type="button"
                    onClick={() => onSelectItem(ex.itemId!)}
                    className="block w-full text-left hover:underline"
                  >
                    <span className="block truncate text-xs text-ig-fg">{ex.title}</span>
                  </button>
                ) : (
                  <span className="block truncate text-xs text-ig-fg">{ex.title}</span>
                )}
                <span className="block truncate text-[11px] text-ig-fg-subtle">{ex.detail}</span>

                {/* Candidatas: a decisão que o motor se recusou a tomar sozinho. */}
                {ex.candidates.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ex.candidates.slice(0, 4).map((c) => (
                      <button
                        key={c.timelineItemId}
                        type="button"
                        onClick={() => onSelectItem(c.timelineItemId)}
                        className="max-w-[220px] truncate rounded border border-ig-border px-1.5 py-0.5 text-[10px] text-ig-fg-muted hover:border-ig-accent hover:text-ig-accent"
                      >
                        {c.wbsCode ? `${c.wbsCode} · ` : ''}{c.title}
                      </button>
                    ))}
                    {ex.candidates.length > 4 && (
                      <span className="px-1 text-[10px] text-ig-fg-subtle">+{ex.candidates.length - 4}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {exceptions.length > previewCount && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-ig-border-subtle px-4 py-1.5 text-[11px] text-ig-fg-muted hover:bg-ig-panel-hover hover:text-ig-fg"
        >
          {expanded ? 'Mostrar menos' : `Ver todas as ${exceptions.length}`}
        </button>
      )}
    </HudPanel>
  );
}
