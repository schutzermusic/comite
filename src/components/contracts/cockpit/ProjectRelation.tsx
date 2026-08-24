'use client';

/**
 * Relação Contrato ↔ Projeto como cidadã de primeira classe.
 *
 * Nunca dentro de menu de overflow: é a ligação que coloca o contrato na visão
 * consolidada de portfólio e na rastreabilidade financeira, e sua AUSÊNCIA é um
 * estado operacional acionável — não um campo vazio.
 *
 * O vínculo vem exclusivamente de `contracts.project_id` ou
 * `contract_project_links`. O auto-match por hash, que atribuía um projeto
 * arbitrário (`projects[seed % length]`), morreu no read model e não pode
 * voltar por aqui.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ArrowUpRight, Workflow, AlertTriangle, Link2 } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { hasOfficialValue, isError, type Official } from '@/lib/contracts/trust/trusted';
import type { Project } from '@/lib/types';

export interface ProjectRelationProps {
  project: Official<Project>;
  /** Ação primária quando não há vínculo. */
  onLink?: () => void;
  className?: string;
  /** Variante compacta para o cabeçalho do Quick Dossier. */
  compact?: boolean;
}

export function ProjectRelation({ project, onLink, className, compact = false }: ProjectRelationProps) {
  // ── Falha de leitura ──────────────────────────────────────────────────────
  if (isError(project)) {
    return (
      <div
        className={cn(
          'rounded-[14px] border border-[color-mix(in_oklab,var(--ig-danger)_30%,transparent)]',
          'bg-[color-mix(in_oklab,var(--ig-danger)_7%,transparent)] px-4 py-3',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-ig-caption font-semibold uppercase tracking-[0.12em] text-ig-danger">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
          Vínculo indisponível
        </p>
        <p className="mt-1 text-ig-body-sm text-ig-fg-muted">
          Não foi possível ler os vínculos de projeto deste contrato.
        </p>
      </div>
    );
  }

  // ── Sem vínculo: estado operacional, não campo vazio ──────────────────────
  if (!hasOfficialValue(project)) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-[14px] border border-[color-mix(in_oklab,var(--ig-warning)_32%,transparent)]',
          'bg-[color-mix(in_oklab,var(--ig-warning)_7%,transparent)] px-4 py-3.5',
          className,
        )}
      >
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-ig-warning"
          aria-hidden
        />
        <p className="text-ig-caption font-semibold uppercase tracking-[0.12em] text-ig-warning">
          Projeto não vinculado
        </p>
        <p className="mt-1.5 text-ig-body-sm leading-relaxed text-ig-fg-muted">
          Este contrato não tem associação com um projeto operacional. Sem ela, fica fora da
          visão consolidada de portfólio e da rastreabilidade financeira.
        </p>
        {onLink && (
          <HudButton
            variant="primary"
            size="sm"
            className="mt-3"
            leftIcon={<Link2 className="h-4 w-4" />}
            onClick={onLink}
          >
            Vincular projeto
          </HudButton>
        )}
      </div>
    );
  }

  // ── Vinculado ─────────────────────────────────────────────────────────────
  const p = project.value;

  return (
    <Link
      href={`/projetos/${p.id}`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'group relative block overflow-hidden rounded-[14px] border border-ig-border-subtle',
        'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ig-bg-raised)_70%,transparent),transparent)]',
        'px-4 py-3.5 transition-all duration-200',
        'hover:border-ig-border-focus hover:bg-[color-mix(in_oklab,var(--ig-accent)_6%,transparent)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ig-accent)_45%,transparent)]',
        className,
      )}
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-ig-accent opacity-70 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-ig-caption font-semibold uppercase tracking-[0.12em] text-ig-fg-muted">
            <Workflow className="h-3.5 w-3.5 text-ig-accent" aria-hidden />
            Projeto
          </p>
          <p className="mt-1.5 truncate text-[15px] font-semibold text-ig-fg-strong">{p.codigo}</p>
          {!compact && (
            <p className="mt-0.5 truncate text-ig-body-sm text-ig-fg-muted">{p.nome}</p>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-ig-caption font-medium text-ig-accent opacity-0 transition-opacity group-hover:opacity-100">
          Abrir
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
