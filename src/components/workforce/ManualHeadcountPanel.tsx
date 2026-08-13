'use client';

import React, { useMemo, useState } from 'react';
import { Check, Loader2, Trash2, Users } from 'lucide-react';
import { HudButton, HudInput, HudSignal } from '@/components/hud';
import { cn } from '@/lib/utils';

/**
 * Lançamento manual do quadro por competência — exclusivo de administrador.
 *
 * Existe para um caso concreto: o pacote do eSocial Download entregou, para
 * 2025, as guias consolidadas e o detalhe de UM trabalhador. O quadro apurado
 * sai como 1 onde havia ~250, e o custo médio do mês vira R$ 871.670 por
 * colaborador.
 *
 * O painel mostra SEMPRE, lado a lado, o que o eSocial apurou e o que está
 * sendo informado. Isso é deliberado: quem lança precisa ver que está cobrindo
 * uma lacuna (apurado = 1) e não sobrescrevendo uma apuração boa (apurado =
 * 248). Sem essa comparação, o campo vira um jeito silencioso de reescrever
 * dado real.
 */
export interface ManualHeadcountCompetence {
  competence: string;
  /** Quadro que o eSocial apurou — a referência contra a qual se lança. */
  esocialHeadcount: number;
  /** Massa da competência, para dar contexto ao número informado. */
  payroll: number;
  manualHeadcount?: number;
  manualNote?: string;
}

export interface ManualHeadcountPanelProps {
  competences: ManualHeadcountCompetence[];
  onSave: (competence: string, headcount: number, sourceNote: string) => Promise<void>;
  onRemove: (competence: string) => Promise<void>;
  className?: string;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function monthLabel(competence: string): string {
  const [y, m] = competence.split('-').map(Number);
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${names[m - 1]}/${y}`;
}

export function ManualHeadcountPanel({
  competences,
  onSave,
  onRemove,
  className,
}: ManualHeadcountPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, { headcount: string; note: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Competências onde o quadro apurado é implausível para a massa declarada.
   * Uma folha de R$ 800 mil com 1 pessoa não é um quadro pequeno — é ausência
   * de dado. São essas que o painel sugere corrigir primeiro.
   */
  const suspect = useMemo(
    () =>
      new Set(
        competences
          .filter((c) => c.payroll > 0 && c.esocialHeadcount <= 1 && c.manualHeadcount === undefined)
          .map((c) => c.competence),
      ),
    [competences],
  );

  const draftFor = (c: ManualHeadcountCompetence) =>
    drafts[c.competence] ?? {
      headcount: c.manualHeadcount !== undefined ? String(c.manualHeadcount) : '',
      note: c.manualNote ?? '',
    };

  const setDraft = (competence: string, patch: Partial<{ headcount: string; note: string }>) => {
    setDrafts((d) => ({
      ...d,
      [competence]: { ...(d[competence] ?? { headcount: '', note: '' }), ...patch },
    }));
  };

  async function handleSave(c: ManualHeadcountCompetence) {
    const draft = draftFor(c);
    const headcount = Number(draft.headcount);
    setError(null);

    if (!Number.isInteger(headcount) || headcount < 0) {
      setError(`${monthLabel(c.competence)}: informe a quantidade como número inteiro.`);
      return;
    }
    if (draft.note.trim().length < 3) {
      setError(
        `${monthLabel(c.competence)}: informe a origem do número (ex.: "folha analítica Domínio").`,
      );
      return;
    }

    setBusy(c.competence);
    try {
      await onSave(c.competence, headcount, draft.note.trim());
      setSaved(c.competence);
      setTimeout(() => setSaved((s) => (s === c.competence ? null : s)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gravar.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(competence: string) {
    setBusy(competence);
    setError(null);
    try {
      await onRemove(competence);
      setDrafts((d) => {
        const next = { ...d };
        delete next[competence];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao remover.');
    } finally {
      setBusy(null);
    }
  }

  if (competences.length === 0) {
    return (
      <p className={cn('text-sm text-ig-fg-muted', className)}>
        Nenhuma competência apurada ainda — importe o pacote do eSocial antes de ajustar o quadro.
      </p>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-start gap-3 rounded-[10px] border border-ig-border-subtle bg-ig-bg-raised p-4">
        <Users className="mt-0.5 h-4 w-4 shrink-0 text-ig-accent" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-ig-fg-strong">Quadro informado manualmente</p>
          <p className="leading-relaxed text-ig-fg-muted">
            Para competências em que o eSocial não entregou o detalhe por trabalhador. O número
            informado substitui o apurado no cálculo de custo médio e turnover, fica marcado como
            manual em toda a interface e <strong className="text-ig-fg-strong">sobrevive a
            reimportações</strong> — inclusive à chegada da tabela de rubricas.
          </p>
          <p className="leading-relaxed text-ig-fg-subtle">
            A origem é obrigatória. Sem ela, ninguém consegue dizer daqui a seis meses de onde veio
            o número.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-[10px] border border-ig-danger/30 bg-ig-danger/5 px-3 py-2 text-sm text-ig-danger">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-ig-border-subtle text-left">
              <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                Competência
              </th>
              <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                Massa
              </th>
              <th className="py-2 pr-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                Apurado
              </th>
              <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                Informado
              </th>
              <th className="py-2 pr-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle">
                Origem
              </th>
              <th className="py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ig-fg-subtle" />
            </tr>
          </thead>
          <tbody>
            {competences.map((c) => {
              const draft = draftFor(c);
              const isBusy = busy === c.competence;
              return (
                <tr key={c.competence} className="border-b border-ig-border-subtle/60 align-middle">
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ig-fg-strong">{monthLabel(c.competence)}</span>
                      {suspect.has(c.competence) && (
                        <HudSignal tone="warning" size="sm" label="quadro" value="ausente" />
                      )}
                      {c.manualHeadcount !== undefined && (
                        <HudSignal tone="info" size="sm" label="quadro" value="manual" />
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-ig-fg-muted">
                    {c.payroll > 0 ? brl(c.payroll) : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-ig-fg-muted">
                    {c.esocialHeadcount}
                  </td>
                  <td className="py-2 pr-3">
                    <HudInput
                      type="number"
                      min={0}
                      step={1}
                      value={draft.headcount}
                      placeholder={String(c.esocialHeadcount)}
                      aria-label={`Colaboradores em ${monthLabel(c.competence)}`}
                      onChange={(e) => setDraft(c.competence, { headcount: e.target.value })}
                      className="w-28"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <HudInput
                      value={draft.note}
                      placeholder="ex.: folha analítica Domínio"
                      aria-label={`Origem do número em ${monthLabel(c.competence)}`}
                      onChange={(e) => setDraft(c.competence, { note: e.target.value })}
                      className="w-full min-w-[200px]"
                    />
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <HudButton
                        variant="secondary"
                        size="sm"
                        disabled={isBusy || draft.headcount === ''}
                        onClick={() => void handleSave(c)}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : saved === c.competence ? (
                          <Check className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          'Salvar'
                        )}
                      </HudButton>
                      {c.manualHeadcount !== undefined && (
                        <HudButton
                          variant="ghost"
                          size="sm"
                          disabled={isBusy}
                          aria-label={`Remover ajuste de ${monthLabel(c.competence)}`}
                          onClick={() => void handleRemove(c.competence)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </HudButton>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
