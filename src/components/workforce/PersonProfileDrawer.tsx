'use client';

/**
 * Ficha do colaborador — o que a seção Pessoas passou a responder no nível do
 * indivíduo, sem que a tabela e o cadastro mudassem.
 *
 * Reúne coisas que já existiam em lugares distintos e nunca tinham sido lidas
 * lado a lado: vínculo e cargo (cadastro), alocação (project_allocations),
 * afastamentos (leave_periods) e histórico salarial (linhas por colaborador
 * dos fechamentos aprovados).
 *
 * O histórico salarial chega PRONTO do pai, e não é buscado aqui: ele vem de
 * uma rota com permissão própria (`people.view_salary`), e um usuário sem ela
 * precisa ver a ficha inteira — só sem a parte de salário. Buscar aqui dentro
 * transformaria falta de permissão em gaveta quebrada.
 */

import { useEffect, useState } from 'react';
import { Briefcase, CalendarDays, Coins, UserCircle2 } from 'lucide-react';
import { HudBadge, HudDrawer, HudStatusPill } from '@/components/hud';
import { listAllocationsByPerson } from '@/lib/services/allocations';
import { listLeavesInPeriod } from '@/lib/services/capacity';
import {
  CONTRACT_TYPE_LABELS,
  LEAVE_TYPE_LABELS,
  type LeavePeriod,
  type Person,
  type PersonProjectAllocation,
} from '@/lib/types/people';
import type { PersonSalaryHistory } from '@/lib/workforce/salary-history';

const NA = '—';

function dateLabel(value: string | null | undefined): string {
  return value ? value.slice(0, 10).split('-').reverse().join('/') : NA;
}

function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

function brl(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return NA;
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

/** Tempo de casa em meses cheios, ou `null` sem data de admissão. */
function tenureMonths(hiredAt: string | null, terminatedAt: string | null): number | null {
  if (!hiredAt) return null;
  const start = new Date(hiredAt);
  const end = terminatedAt ? new Date(terminatedAt) : new Date();
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
}

export interface PersonProfileDrawerProps {
  person: Person | null;
  onClose: () => void;
  /** Série salarial da pessoa. `undefined` = sem permissão ou sem série. */
  salary?: PersonSalaryHistory;
  /** Motivo de o bloco salarial estar ausente, quando há um. */
  salaryUnavailableReason?: string;
}

export function PersonProfileDrawer({
  person,
  onClose,
  salary,
  salaryUnavailableReason,
}: PersonProfileDrawerProps) {
  const [allocations, setAllocations] = useState<PersonProjectAllocation[]>([]);
  const [leaves, setLeaves] = useState<LeavePeriod[]>([]);
  /**
   * Qual pessoa já foi carregada.
   *
   * Guardar isto em vez de um booleano `loading` evita marcar estado de forma
   * síncrona dentro do efeito (render em cascata) e ainda resolve o caso de
   * trocar de pessoa com a gaveta aberta: enquanto o id não bate, o conteúdo
   * mostrado é "carregando", e não os dados de quem estava aberto antes.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = Boolean(person) && loadedFor !== person?.id;

  useEffect(() => {
    if (!person) return;
    let cancelled = false;
    void (async () => {
      // Falha em silêncio por bloco: sem alocação a ficha continua útil.
      const [allocs, leavePeriods] = await Promise.all([
        listAllocationsByPerson(person.id).catch(() => [] as PersonProjectAllocation[]),
        // Janela ampla: a ficha quer o histórico, não o mês corrente.
        listLeavesInPeriod('2000-01-01', '2100-12-31').catch(() => [] as LeavePeriod[]),
      ]);
      if (cancelled) return;
      setAllocations(allocs);
      setLeaves(leavePeriods.filter((l) => l.personId === person.id));
      setLoadedFor(person.id);
    })();
    return () => { cancelled = true; };
  }, [person]);

  if (!person) return null;

  const tenure = tenureMonths(person.hiredAt, person.terminatedAt);

  return (
    <HudDrawer
      isOpen={Boolean(person)}
      onClose={onClose}
      title={person.fullName}
      subtitle={person.jobTitle ?? 'Sem cargo informado'}
      width="560px"
    >
      <div className="space-y-6">
        {/* ── Vínculo ── */}
        <Section icon={<UserCircle2 className="h-4 w-4" />} title="Vínculo">
          <Field label="Situação">
            <HudStatusPill size="sm" variant={person.status === 'active' ? 'active' : 'neutral'}>
              {person.status === 'active' ? 'Ativo' : person.status === 'inactive' ? 'Inativo' : person.status}
            </HudStatusPill>
          </Field>
          <Field label="Admissão">{dateLabel(person.hiredAt)}</Field>
          <Field label="Tempo de casa">
            {tenure === null ? NA : `${tenure} mês(es)`}
          </Field>
          <Field label="Vínculo">
            {person.contractType ? CONTRACT_TYPE_LABELS[person.contractType] : NA}
          </Field>
          <Field label="Cargo / Área">
            {person.jobTitle ?? NA}
            {person.department ? ` · ${person.department}` : ''}
          </Field>
          <Field label="Jornada contratual">{person.weeklyHours}h/semana</Field>
          {person.terminatedAt && (
            <Field label="Desligamento">
              <span className="text-ig-danger">{dateLabel(person.terminatedAt)}</span>
            </Field>
          )}
        </Section>

        {/* ── Alocação ── */}
        <Section icon={<Briefcase className="h-4 w-4" />} title="Alocação e projetos">
          {loading ? (
            <p className="text-sm text-ig-fg-muted">Carregando…</p>
          ) : allocations.length === 0 ? (
            <p className="text-sm text-ig-fg-subtle">Sem alocação registrada.</p>
          ) : (
            <div className="space-y-2">
              {allocations.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 border-b border-ig-border-subtle pb-2 last:border-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ig-fg-strong">{a.roleTitle ?? 'Alocação'}</p>
                    <p className="text-[11px] text-ig-fg-muted">
                      {dateLabel(a.startDate)} → {a.endDate ? dateLabel(a.endDate) : 'em aberto'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm tabular-nums text-ig-fg-muted">{a.plannedPercentage}%</span>
                    <HudBadge size="sm" variant={a.status === 'active' ? 'success' : 'subtle'}>
                      {a.status}
                    </HudBadge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Histórico salarial ── */}
        <Section icon={<Coins className="h-4 w-4" />} title="Histórico salarial">
          {salaryUnavailableReason ? (
            <p className="text-sm text-ig-fg-subtle">{salaryUnavailableReason}</p>
          ) : !salary ? (
            <p className="text-sm text-ig-fg-subtle">
              Sem série de folha para esta pessoa. A série vem das linhas por colaborador dos
              fechamentos aprovados, casadas pelo nome normalizado.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Bruto atual" value={brl(salary.currentGrossCents)} />
                <Metric
                  label="Último reajuste"
                  value={salary.lastRaiseCompetence ? shortMonth(salary.lastRaiseCompetence) : NA}
                  hint={
                    salary.lastRaisePercent === null
                      ? undefined
                      : `${salary.lastRaisePercent > 0 ? '+' : ''}${salary.lastRaisePercent.toFixed(1)}%`
                  }
                />
                <Metric
                  label="Meses no patamar"
                  value={
                    salary.monthsSinceLastRaise === null
                      ? NA
                      : `${salary.monthsIsLowerBound ? '≥ ' : ''}${salary.monthsSinceLastRaise}`
                  }
                  hint={salary.monthsIsLowerBound ? 'limite inferior — patamar pode ter começado antes da janela' : undefined}
                />
                <Metric
                  label="Situação"
                  value={
                    salary.raiseStatus === 'stale'
                      ? '+12 meses sem reajuste'
                      : salary.raiseStatus === 'recent'
                        ? 'Reajustado'
                        : 'Não determinado'
                  }
                />
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ig-fg-subtle">
                  Patamares
                </p>
                <div className="space-y-1">
                  {salary.levels.map((l, i) => (
                    <div key={`${l.startCompetence}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-ig-fg-muted">
                        {l.truncatedStart ? '≤ ' : ''}{shortMonth(l.startCompetence)} → {shortMonth(l.endCompetence)}
                      </span>
                      <span className="tabular-nums text-ig-fg-strong">{brl(l.grossCents)}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ig-fg-muted">
                  Patamar = dois meses consecutivos no mesmo bruto. Meses variáveis (13º, férias,
                  rescisão complementar) não abrem patamar — do contrário todo dezembro apareceria
                  como reajuste.
                </p>
              </div>
            </div>
          )}
        </Section>

        {/* ── Afastamentos ── */}
        <Section icon={<CalendarDays className="h-4 w-4" />} title="Afastamentos e ausências">
          {loading ? (
            <p className="text-sm text-ig-fg-muted">Carregando…</p>
          ) : leaves.length === 0 ? (
            <p className="text-sm text-ig-fg-subtle">Nenhum afastamento registrado.</p>
          ) : (
            <div className="space-y-2">
              {[...leaves]
                .sort((a, b) => b.startDate.localeCompare(a.startDate))
                .map((l) => (
                  <div key={l.id} className="flex items-start justify-between gap-3 border-b border-ig-border-subtle pb-2 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-ig-fg-strong">{LEAVE_TYPE_LABELS[l.type] ?? l.type}</p>
                      <p className="text-[11px] text-ig-fg-muted">
                        {dateLabel(l.startDate)} → {dateLabel(l.endDate)}
                      </p>
                    </div>
                    <HudBadge size="sm" variant={l.status === 'cancelled' ? 'subtle' : 'info'}>
                      {l.status}
                    </HudBadge>
                  </div>
                ))}
            </div>
          )}
        </Section>
      </div>
    </HudDrawer>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-ig-accent">{icon}</span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ig-fg-muted">{title}</h3>
        <div className="h-px flex-1 bg-ig-border-subtle" />
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ig-border-subtle py-1.5 last:border-0">
      <span className="text-sm text-ig-fg-muted">{label}</span>
      <span className="shrink-0 text-sm text-ig-fg-strong">{children}</span>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-ig-border-subtle p-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ig-fg-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-ig-fg-strong">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-tight text-ig-fg-muted">{hint}</p>}
    </div>
  );
}
