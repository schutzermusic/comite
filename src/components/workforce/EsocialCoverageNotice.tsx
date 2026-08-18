'use client';

import React from 'react';
import { AlertTriangle, FileWarning, Info } from 'lucide-react';
import { HudSignal, signalToneStyle, type HudSignalTone } from '@/components/hud';
import { cn } from '@/lib/utils';
import type { CompetenceCoverage, CoverageSummary } from '@/lib/workforce/esocial-coverage';

/**
 * O que os números desta tela NÃO conseguem afirmar.
 *
 * Existe porque um indicador incompleto e um indicador completo se parecem
 * exatamente iguais na tela: os dois são um número formatado. A diferença mora
 * na procedência, e procedência sem lugar de exibição vira conclusão errada —
 * um mês que só tem totalizador mostra folha baixa ao lado de guia alta, e quem
 * lê conclui que a empresa recolheu imposto demais.
 *
 * Some quando não há nada a ressalvar: aviso permanente vira decoração e deixa
 * de ser lido.
 */
export interface EsocialCoverageNoticeProps {
  /** Cobertura da competência em foco. */
  coverage?: CompetenceCoverage;
  /** Panorama do acervo, para o caso de a lacuna ser sistêmica. */
  summary?: CoverageSummary;
  className?: string;
}

export function EsocialCoverageNotice({
  coverage,
  summary,
  className,
}: EsocialCoverageNoticeProps) {
  const systemic =
    summary !== undefined && summary.total > 0 && summary.withComposition === 0;

  if (!coverage?.note && !systemic) return null;

  const tone: HudSignalTone = coverage?.detail === 'missing' ? 'warning' : 'info';
  const Icon = coverage?.detail === 'missing' ? FileWarning : systemic ? AlertTriangle : Info;

  return (
    <div
      style={signalToneStyle(tone)}
      className={cn(
        'flex flex-col gap-3 rounded-[10px] border p-4 sm:flex-row sm:items-start',
        'border-[color:color-mix(in_oklab,var(--sig-tone)_28%,transparent)]',
        'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--sig-tone)_9%,transparent),transparent_65%)]',
        className,
      )}
    >
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--sig-tone)]"
        aria-hidden
      />

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ig-fg-strong">
            Procedência dos números
          </span>
          {coverage && (
            <HudSignal
              tone={tone}
              label={coverage.competence}
              value={
                coverage.payrollSource === 'rubricas'
                  ? 'folha detalhada'
                  : coverage.payrollSource === 'payslip_pdf'
                    ? 'PDF provisório'
                  : coverage.payrollSource === 'base_esocial'
                    ? 'base apurada'
                    : 'sem massa'
              }
            />
          )}
        </div>

        {coverage?.note && (
          <p className="text-sm leading-relaxed text-ig-fg-muted">{coverage.note}</p>
        )}

        {systemic && (
          <p className="text-sm leading-relaxed text-ig-fg-muted">
            Nenhuma das {summary!.total} competências tem a composição da folha classificada.
            O pacote do eSocial Download traz apenas as <em>alterações</em> recentes da tabela de
            rubricas (S-1010), não a tabela inteira — peça à contabilidade a{' '}
            <strong className="text-ig-fg-strong">
              exportação completa da tabela de rubricas (S-1010)
            </strong>
            . Com ela, horas extras, benefícios e descontos passam a ser apurados sobre todo o
            histórico já importado, sem precisar reimportar nada.
          </p>
        )}
      </div>
    </div>
  );
}
