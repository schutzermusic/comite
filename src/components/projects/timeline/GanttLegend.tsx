'use client';

/**
 * Legenda compacta do Gantt.
 *
 * Colapsável e de baixo contraste de propósito: quem já conhece a linguagem
 * visual não precisa dela ocupando peso na tela, mas ela precisa existir —
 * hachura, tracejado e trilho fino não são autoexplicativos.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

function Swatch({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="flex h-3 w-6 items-center justify-center">{children}</span>
      <span>{label}</span>
    </span>
  );
}

const TRACK = (tone: string) => `color-mix(in oklab, ${tone} 18%, transparent)`;
const FILL = (tone: string) => `color-mix(in oklab, ${tone} 88%, transparent)`;
const EDGE = (tone: string) => `color-mix(in oklab, ${tone} 45%, transparent)`;

function Bar({ tone, dashed, hatched }: { tone: string; dashed?: boolean; hatched?: boolean }) {
  return (
    <span
      className="block h-2.5 w-6 overflow-hidden rounded"
      style={{ background: TRACK(tone), border: `1px ${dashed ? 'dashed' : 'solid'} ${EDGE(tone)}` }}
    >
      <span
        className="block h-full w-1/2"
        style={{
          background: hatched
            ? `repeating-linear-gradient(45deg, ${FILL(tone)} 0 3px, transparent 3px 6px)`
            : FILL(tone),
        }}
      />
    </span>
  );
}

export function GanttLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn('rounded-lg border border-ig-border-subtle bg-ig-panel/60', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ig-fg-subtle hover:text-ig-fg-muted"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Legenda
      </button>

      {open && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-ig-border-subtle px-3 py-2 text-[10px] text-ig-fg-muted">
          <Swatch label="Fase">
            <span className="relative block h-2.5 w-6">
              <span className="absolute inset-x-0 top-0 h-[4px] rounded-sm bg-ig-fg-muted" />
              <span className="absolute left-0 top-0 h-2.5 w-[2px] bg-ig-fg-muted" />
              <span className="absolute right-0 top-0 h-2.5 w-[2px] bg-ig-fg-muted" />
            </span>
          </Swatch>
          <Swatch label="No prazo"><Bar tone="var(--ig-accent)" /></Swatch>
          <Swatch label="Em risco"><Bar tone="var(--ig-warning)" dashed /></Swatch>
          <Swatch label="Atrasada"><Bar tone="var(--ig-danger)" /></Swatch>
          <Swatch label="Bloqueada"><Bar tone="var(--ig-danger)" hatched /></Swatch>
          <Swatch label="Concluída"><Bar tone="var(--ig-success)" /></Swatch>
          <Swatch label="Marco">
            <span
              className="block h-2.5 w-2.5 rotate-45 border"
              style={{ background: FILL('var(--ig-accent)'), borderColor: EDGE('var(--ig-accent)') }}
            />
          </Swatch>
          <Swatch label="Execução real">
            <span className="block h-[3px] w-6 rounded-full" style={{ background: FILL('var(--ig-accent)') }} />
          </Swatch>
          <Swatch label="Previsão estourada">
            <span
              className="block h-2.5 w-6 rounded"
              style={{
                backgroundImage: `repeating-linear-gradient(45deg, ${FILL('var(--ig-danger)')} 0 3px, transparent 3px 6px)`,
              }}
            />
          </Swatch>
          <Swatch label="Hoje">
            <span className="block h-3 w-[2px]" style={{ background: 'var(--ig-danger)' }} />
          </Swatch>
          <Swatch label="Dependência">
            <svg width="24" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--ig-fg-subtle)" strokeWidth="1" />
              <path d="M 18 1 L 23 4 L 18 7 z" fill="var(--ig-fg-subtle)" />
            </svg>
          </Swatch>
          <Swatch label="Sequência violada">
            <svg width="24" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--ig-danger)" strokeWidth="1.5" />
              <path d="M 18 1 L 23 4 L 18 7 z" fill="var(--ig-danger)" />
            </svg>
          </Swatch>
          <Swatch label="Ramo recolhido">
            <svg width="24" height="8" aria-hidden>
              <line x1="0" y1="4" x2="18" y2="4" stroke="var(--ig-fg-subtle)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <path d="M 18 1 L 23 4 L 18 7 z" fill="var(--ig-fg-subtle)" opacity="0.6" />
            </svg>
          </Swatch>
          <Swatch label="Ativo agora">
            <span
              className="block h-2 w-2 rounded-full"
              style={{ background: 'var(--ig-success)', boxShadow: '0 0 0 3px color-mix(in oklab, var(--ig-success) 25%, transparent)' }}
            />
          </Swatch>
          <Swatch label="Sem apontamento">
            <span className="block h-2 w-2 rounded-full border border-ig-fg-disabled" />
          </Swatch>
        </div>
      )}
    </div>
  );
}
