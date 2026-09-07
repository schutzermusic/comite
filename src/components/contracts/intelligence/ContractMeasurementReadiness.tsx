'use client';

/**
 * MEDIÇÃO EM CONTEXTO — o lado de CONTRATOS.
 *
 * ─── A fronteira que este arquivo respeita ─────────────────────────────────
 *
 * Contratos mostra a regra e a consequência dela. NÃO edita medição, não
 * submete, não aceita e não vincula evidência. Tudo isso é Projetos, porque a
 * instância de medição é operacional — e um segundo editor da mesma coisa em
 * outra tela é como duas verdades começam.
 *
 * O que o usuário de Contratos precisa saber aqui é exatamente três coisas:
 *
 *   · o que o contrato exige medir, e quando;
 *   · o que está travado, e por quê;
 *   · onde ir para resolver — que é o projeto, com link.
 *
 * ─── O que esta tela recusa mostrar ────────────────────────────────────────
 *
 * Total de "R$ pronto para faturar". A §58 do plano é explícita, e a razão é
 * concreta: esse número seria lido como previsão de caixa por quem decide
 * caixa, e a Fase 6 não sabe se há direito de faturar — isso é Fase 7.
 * O que aparece é o VALOR ACEITO, que é fato, com a contagem que o sustenta.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, HelpCircle, Loader2, Ruler } from 'lucide-react';
import { HudBadge, HudPanel } from '@/components/hud';
import { InlineEmpty } from '../shell';
import { cn } from '@/lib/utils';
import { listContractMeasurements } from '@/lib/projects/measurements/measurement-service';
import {
  MEASUREMENT_STATUS_LABEL, readinessReasonLabel,
  type ProjectMeasurementRow, type ReadinessState,
} from '@/lib/projects/measurements/types';

const STATE_TONE: Record<ReadinessState, string> = {
  READY: 'text-ig-success',
  BLOCKED: 'text-ig-danger',
  INCOMPLETE: 'text-ig-warning',
  NOT_APPLICABLE: 'text-ig-fg-subtle',
  UNKNOWN: 'text-ig-warning',
};

const STATE_LABEL: Record<ReadinessState, string> = {
  READY: 'Pronta',
  BLOCKED: 'Bloqueada',
  INCOMPLETE: 'Incompleta',
  NOT_APPLICABLE: 'Não se aplica',
  UNKNOWN: 'Desconhecida',
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const BRL = (v: number, currency: string | null) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);

export function ContractMeasurementReadiness({ contractId }: { contractId: string }) {
  const [rows, setRows] = useState<ProjectMeasurementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await listContractMeasurements(contractId);
        if (active) setRows(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { active = false; };
  }, [contractId]);

  const summary = useMemo(() => {
    if (!rows) return null;
    const live = rows.filter((m) => !['SUPERSEDED', 'CANCELLED'].includes(m.status));
    const accepted = live.filter((m) => m.status === 'ACCEPTED');

    /*
      A soma dos valores ACEITOS, e só deles.

      Não é "pronto para faturar" e não inclui submetido nem apurado: aceito é
      o único estado em que alguém com autoridade disse sim. Medições aceitas
      SEM valor monetário (percentual, marco fixo) ficam de fora da soma e
      dentro da contagem — e a diferença entre as duas é dita na tela, senão o
      total pareceria cobrir todas.
    */
    const comValor = accepted.filter((m) => m.accepted_value !== null);
    const total = comValor.reduce((s, m) => s + Number(m.accepted_value ?? 0), 0);
    const currency = comValor.find((m) => m.accepted_currency)?.accepted_currency ?? null;

    return {
      live,
      acceptedCount: accepted.length,
      valuedCount: comValor.length,
      total: comValor.length > 0 ? total : null,
      currency,
      blocked: live.filter((m) => m.readiness_overall === 'BLOCKED').length,
      unknown: live.filter((m) => m.readiness_overall === 'UNKNOWN' || m.readiness_overall === null).length,
    };
  }, [rows]);

  if (error) {
    return (
      <HudPanel>
        <div className="p-4 text-sm text-ig-danger">{error}</div>
      </HudPanel>
    );
  }

  if (!rows || !summary) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-4 text-sm text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando medições…
        </div>
      </HudPanel>
    );
  }

  if (summary.live.length === 0) {
    return (
      <HudPanel>
        <div className="p-4">
          {/*
            A ausência aponta para a CAUSA. Uma regra de medição sem projeto
            vinculado e sem etapa mapeada não gera candidato — e essa é a
            recusa correta, não uma falha a esconder atrás de "nenhum registro".
          */}
          <InlineEmpty
            message="Nenhuma medição operacional para este contrato"
            help={
              'As regras de medição deste contrato ainda não geraram instâncias operacionais. '
              + 'Isso acontece quando falta o vínculo com um projeto ou o mapeamento da regra a uma '
              + 'etapa do cronograma. O Apex não cria medição sem os dois.'
            }
          />
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel>
      <div className="border-b border-ig-border-subtle/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Ruler className="h-4 w-4 text-ig-fg-muted" />
          <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
            Medição em contexto
          </h3>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-ig-border-subtle/40">
        <div className="bg-ig-surface-1 p-3">
          <div className="text-[10px] uppercase text-ig-fg-subtle">Valor aceito</div>
          <div className="mt-0.5 text-sm text-ig-fg">
            {summary.total === null ? (
              // Ausência DITA. Escrever R$ 0 afirmaria que nada foi aceito.
              <span className="text-ig-fg-subtle">nenhum valor aceito</span>
            ) : BRL(summary.total, summary.currency)}
          </div>
          <div className="mt-0.5 text-[10px] text-ig-fg-subtle">
            {summary.acceptedCount} aceita(s)
            {summary.acceptedCount > summary.valuedCount
              && `, ${summary.acceptedCount - summary.valuedCount} sem valor monetário`}
          </div>
        </div>
        <div className="bg-ig-surface-1 p-3">
          <div className="text-[10px] uppercase text-ig-fg-subtle">Bloqueadas</div>
          <div className={cn('mt-0.5 text-sm', summary.blocked > 0 ? 'text-ig-danger' : 'text-ig-fg')}>
            {summary.blocked}
          </div>
        </div>
        <div className="bg-ig-surface-1 p-3">
          <div className="text-[10px] uppercase text-ig-fg-subtle">Sem verdade resolvida</div>
          <div className={cn('mt-0.5 text-sm', summary.unknown > 0 ? 'text-ig-warning' : 'text-ig-fg')}>
            {summary.unknown}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-ig-border-subtle/30">
        {summary.live.map((m) => {
          const state = (m.readiness_overall ?? 'UNKNOWN') as ReadinessState;
          const reasons = (m.readiness_reasons ?? []).slice(0, 2);
          return (
            <li key={m.id} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] text-ig-fg">
                    {m.rule_title ?? 'Medição'}
                    <span className="ml-2 text-[11px] text-ig-fg-subtle">{m.occurrence_key}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-ig-fg-muted">
                    <HudBadge>{MEASUREMENT_STATUS_LABEL[m.status]}</HudBadge>
                    <span>prevista {fmtDate(m.expected_at)}</span>
                    {m.timeline_title && <span className="truncate">etapa: {m.timeline_title}</span>}
                  </div>
                  {reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {reasons.map((r) => (
                        <li key={r} className="flex items-start gap-1.5 text-[11px] text-ig-fg-muted">
                          {state === 'UNKNOWN'
                            ? <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-ig-warning" />
                            : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-ig-warning" />}
                          {readinessReasonLabel(r)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={cn('text-[11px]', STATE_TONE[state])}>{STATE_LABEL[state]}</span>
                  {/*
                    O caminho para RESOLVER está em Projetos, e o link leva
                    direto para lá. Contratos não ganha um editor paralelo.
                  */}
                  <Link
                    href={`/projetos/${m.project_id}?tab=measurements`}
                    className="inline-flex items-center gap-0.5 text-[11px] text-ig-accent hover:underline"
                  >
                    abrir <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </HudPanel>
  );
}
