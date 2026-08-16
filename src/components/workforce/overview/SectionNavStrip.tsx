'use client';

/**
 * A faixa que mantém a Visão Geral como cockpit.
 *
 * Cada seção do módulo tem uma pergunta própria e um nível de detalhe próprio.
 * Trazer esse detalhe para cá seria o caminho mais curto para transformar o
 * cockpit numa página com todos os indicadores — que é exatamente o que ele
 * não pode ser. O número aparece nos KPIs; a análise mora atrás destes links.
 */

import Link from 'next/link';
import { ArrowRight, Coins, FileSpreadsheet, HeartPulse, ShieldAlert } from 'lucide-react';

interface SectionNavStripProps {
  canSeePayroll: boolean;
}

export function SectionNavStrip({ canSeePayroll }: SectionNavStripProps) {
  const targets = [
    {
      href: '/workforce-cost/custos',
      icon: Coins,
      title: 'Folha & Encargos',
      description: 'Composição da folha, INSS/FGTS/IRRF, custo por lotação e variação salarial.',
    },
    {
      href: '/workforce-cost/sst',
      icon: HeartPulse,
      title: 'SST / ASO & CAT',
      description: 'Acidentes, saúde ocupacional e exposição a agentes nocivos.',
    },
    {
      href: '/workforce-cost/governanca',
      icon: ShieldAlert,
      title: 'Governança',
      description: 'Exceções operacionais classificadas para análise.',
    },
    ...(canSeePayroll
      ? [
          {
            href: '/workforce-cost/fechamento-folha',
            icon: FileSpreadsheet,
            title: 'Fechamento da Folha',
            description: 'Importar folha, anexar holerites, enviar ao financeiro — e o Controle eSocial.',
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {targets.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className="group relative flex items-start gap-3 overflow-hidden rounded-2xl border border-ig-border-subtle bg-ig-panel p-4 transition-colors hover:border-ig-border-focus"
          >
            <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-ig-accent/50 opacity-0 transition-opacity group-hover:opacity-100" />
            <span className="shrink-0 rounded-xl bg-ig-accent-weak p-2">
              <Icon className="h-4 w-4 text-ig-accent" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-semibold text-ig-fg-strong">
                {t.title}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-ig-fg-muted">
                {t.description}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
