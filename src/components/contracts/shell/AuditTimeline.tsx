'use client';

/**
 * A ÚNICA timeline de auditoria do módulo.
 *
 * Antes eram três implementações do mesmo desenho — `Timeline` e `SideTimeline`
 * no dossiê e um trilho reescrito à mão em `AuditSection` na carteira — que já
 * haviam divergido entre si. Uma só, com uma fonte de rótulos só.
 *
 * Duas regras de leitura, herdadas de P0.4 e mantidas:
 *
 * 1. O evento é o registro de `audit_logs`. Nada é sintetizado, nada é
 *    reordenado, nada é agregado.
 * 2. O rótulo de negócio é o texto primário; o código técnico
 *    (`contract.reclassified`) continua visível como metadado — é a evidência
 *    de auditoria, e some da hierarquia, não da tela.
 */

import { format } from 'date-fns';
import { pt } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { ContractAuditEventRow } from '@/lib/contracts/contract-service';
import { auditActionLabel } from '@/lib/contracts/audit-labels';
import { InlineEmpty } from './InlineEmpty';

export interface AuditTimelineProps {
  rows: ContractAuditEventRow[];
  error?: string | null;
  /** Corta a lista; sem limite, mostra tudo. */
  max?: number;
  /** Mapeia `entity_id` → código do contrato (uso na carteira). */
  codeById?: Map<string, string>;
  className?: string;
}

/** Rejeição é o único desvio de tom: o resto do log é registro, não alarme. */
function toneFor(action: string): 'warning' | 'done' {
  return action.includes('rejected') ? 'warning' : 'done';
}

export function AuditTimeline({ rows, error, max, codeById, className }: AuditTimelineProps) {
  if (error) {
    return (
      <p className="py-2 text-ig-body-sm text-ig-danger" role="status">
        Falha ao ler o histórico de auditoria. <span className="text-ig-fg-muted">{error}</span>
      </p>
    );
  }

  if (rows.length === 0) {
    return <InlineEmpty message="Nenhum evento de auditoria registrado." />;
  }

  const visible = max ? rows.slice(0, max) : rows;

  return (
    <ol className={cn('relative space-y-0', className)}>
      {/* Trilho contínuo atrás dos marcadores. */}
      <span className="absolute bottom-2 left-[3.5px] top-2 w-px bg-ig-border-subtle" aria-hidden />

      {visible.map((row) => {
        const tone = toneFor(row.action);
        const code = codeById?.get((row as ContractAuditEventRow & { entity_id?: string }).entity_id ?? '');

        return (
          /*
            `key` é o id da linha. Antes era `${title}-${actor}`: dois eventos da
            mesma ação pelo mesmo ator — "Documento enviado" duas vezes, o caso
            mais comum do módulo — colidiam, e o React reaproveitava a linha
            errada.
          */
          <li key={row.id} className="relative flex gap-3 py-2 pl-0">
            <span
              className={cn(
                'relative z-10 mt-[7px] h-2 w-2 shrink-0 rounded-full ring-2 ring-ig-bg-canvas',
                tone === 'warning' ? 'bg-ig-warning' : 'bg-ig-success',
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-ig-body-sm text-ig-fg-strong">
                {auditActionLabel(row.action)}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-ig-caption text-ig-fg-muted">
                <span>{row.actor_user_id ? 'Usuário autenticado' : 'Sistema'}</span>
                <span aria-hidden>·</span>
                <time dateTime={row.created_at}>
                  {format(new Date(row.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: pt })}
                </time>
                {code && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="ig-tabular">{code}</span>
                  </>
                )}
              </p>
              {/*
                Código técnico preservado. Fica em `font-mono` discreto, abaixo
                do rótulo humano — quem audita ainda encontra; quem opera não
                tropeça.
              */}
              <code className="mt-0.5 block truncate font-mono text-ig-caption text-ig-fg-subtle">
                {row.action}
              </code>
            </div>
          </li>
        );
      })}

      {max && rows.length > max && (
        <li className="pl-5 pt-1 text-ig-caption text-ig-fg-subtle">
          + {rows.length - max} evento(s) anteriores
        </li>
      )}
    </ol>
  );
}
