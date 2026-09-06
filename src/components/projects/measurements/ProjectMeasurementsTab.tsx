'use client';

/**
 * MEDIÇÕES DO PROJETO — a superfície operacional da Fase 6.
 *
 * ─── A pergunta que a tela responde ────────────────────────────────────────
 *
 * "O que falta para esta medição poder ser faturada depois — e de quem é o
 * trabalho que falta?"
 *
 * Ela responde ANTES de a medição vencer, que é o ponto do produto: o gestor
 * descobre o que falta enquanto ainda dá para providenciar, e não no dia em
 * que o cliente cobra o boletim.
 *
 * ─── Três coisas que esta tela recusa fazer ────────────────────────────────
 *
 *   · Não mostra "R$ pronto para faturar". Direito de faturar é Fase 7, e
 *     um número aqui viraria promessa de caixa.
 *   · Não apresenta evidência inferida como evidência confirmada. O que o
 *     Apex deduziu fica marcado como deduzido até alguém validar.
 *   · Não tem etapa de "Análise IA" no ciclo de vida. O ciclo é o que o
 *     contrato e a operação reconhecem: preparação, submissão, aceite.
 *
 * ─── E uma que ela faz questão de fazer ────────────────────────────────────
 *
 * Distinguir "falta o laudo" de "o contrato não diz se exige laudo". O
 * primeiro é trabalho; o segundo é uma lacuna contratual, e mandar alguém
 * caçar um documento que talvez não exista é o pior desfecho dos dois.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleSlash, FileCheck2, HelpCircle,
  Loader2, Ruler, ShieldQuestion,
} from 'lucide-react';
import { HudBadge, HudEmptyState, HudPanel } from '@/components/hud';
import { cn } from '@/lib/utils';
import {
  listProjectMeasurements, getMeasurementPackage, MeasurementError,
} from '@/lib/projects/measurements/measurement-service';
import {
  MEASUREMENT_STATUS_LABEL, READINESS_DIMENSION_LABEL, REQUIREMENT_KIND_LABEL,
  EVIDENCE_CLASS_LABEL, ACCEPTANCE_SOURCE_LABEL, readinessReasonLabel,
  type MeasurementPackage, type ProjectMeasurementRow,
  type ReadinessDimension, type ReadinessState,
} from '@/lib/projects/measurements/types';

/**
 * O tom de cada estado de prontidão.
 *
 * `UNKNOWN` recebe tom de ATENÇÃO, e não neutro. Pintar desconhecido de
 * cinza-calmo é como uma lacuna contratual atravessa uma revisão inteira sem
 * ninguém notar — o cinza lê como "nada a fazer aqui".
 */
const STATE_TONE: Record<ReadinessState, { text: string; bg: string; label: string }> = {
  READY: { text: 'text-ig-success', bg: 'bg-ig-success/10', label: 'Pronto' },
  BLOCKED: { text: 'text-ig-danger', bg: 'bg-ig-danger/10', label: 'Bloqueado' },
  INCOMPLETE: { text: 'text-ig-warning', bg: 'bg-ig-warning/10', label: 'Incompleto' },
  NOT_APPLICABLE: { text: 'text-ig-fg-subtle', bg: 'bg-ig-border-subtle/30', label: 'Não se aplica' },
  UNKNOWN: { text: 'text-ig-warning', bg: 'bg-ig-warning/10', label: 'Desconhecido' },
};

const STATE_ICON: Record<ReadinessState, React.ComponentType<{ className?: string }>> = {
  READY: CheckCircle2,
  BLOCKED: AlertTriangle,
  INCOMPLETE: AlertTriangle,
  NOT_APPLICABLE: CircleSlash,
  UNKNOWN: HelpCircle,
};

const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const fmtMoney = (v: number | string | null, currency: string | null) => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(n);
};

function ReadinessPill({ state }: { state: ReadinessState }) {
  const tone = STATE_TONE[state];
  const Icon = STATE_ICON[state];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium',
      tone.bg, tone.text)}>
      <Icon className="h-3 w-3" />
      {tone.label}
    </span>
  );
}

/** O valor da medição, com a PROCEDÊNCIA dele — nunca um número solto. */
function MeasuredValue({ m }: { m: ProjectMeasurementRow }) {
  /*
    Aceito ganha do apurado, e a diferença é dita. Mostrar só um número faria
    "submeti 100, aceitaram 90" parecer "sempre foi 90".
  */
  const accepted = fmtMoney(m.accepted_value, m.accepted_currency);
  const measured = fmtMoney(m.measured_value, m.currency);

  if (accepted) {
    return (
      <div className="text-right">
        <div className="font-medium text-ig-success">{accepted}</div>
        <div className="text-[10px] text-ig-fg-subtle">aceito</div>
        {measured && measured !== accepted && (
          <div className="text-[10px] text-ig-fg-muted">apurado: {measured}</div>
        )}
      </div>
    );
  }
  if (measured) {
    return (
      <div className="text-right">
        <div className="text-ig-fg">{measured}</div>
        <div className="text-[10px] text-ig-fg-subtle">apurado, não aceito</div>
      </div>
    );
  }
  // Ausência DITA. Um traço solto seria lido como zero.
  return <div className="text-right text-[11px] text-ig-fg-subtle">sem valor apurado</div>;
}

function MeasurementRow({
  m, selected, onSelect,
}: { m: ProjectMeasurementRow; selected: boolean; onSelect: () => void }) {
  const readiness = (m.readiness_overall ?? 'UNKNOWN') as ReadinessState;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors',
        selected ? 'border-ig-accent bg-ig-accent/5' : 'border-transparent hover:bg-ig-surface-2/40',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ig-fg">
          {m.rule_title ?? 'Medição'}
          <span className="ml-2 text-[11px] text-ig-fg-subtle">{m.occurrence_key}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ig-fg-muted">
          <HudBadge>{MEASUREMENT_STATUS_LABEL[m.status]}</HudBadge>
          <span>prevista {fmtDate(m.expected_at)}</span>
          {m.revision > 1 && <span>rev. {m.revision}</span>}
          {/* Ocorrência não identificada é fato de primeira classe, não erro. */}
          {m.occurrence_state === 'unresolved' && (
            <span className="text-ig-warning">ocorrência não identificada</span>
          )}
        </div>
      </div>
      <MeasuredValue m={m} />
      <ReadinessPill state={readiness} />
    </button>
  );
}

/** O PACOTE: exigências, evidência e o que falta, com a origem contratual. */
function MeasurementPackageView({ pkg }: { pkg: MeasurementPackage }) {
  const { measurement: m, requirements, evidence, readiness, history } = pkg;

  const dims = Object.keys(READINESS_DIMENSION_LABEL) as ReadinessDimension[];

  return (
    <div className="space-y-4">
      {/* ── Prontidão por dimensão ── */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">Prontidão</h4>
          {/* A idade do cálculo fica visível. Prontidão é derivada, e uma
              leitura velha precisa ser reconhecível como velha. */}
          {readiness.computedAt && (
            <span className="text-[10px] text-ig-fg-subtle">
              calculada em {fmtDate(readiness.computedAt)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {dims.map((d) => (
            <div key={d} className={cn('rounded px-2 py-1.5', STATE_TONE[readiness.dimensions[d]].bg)}>
              <div className="text-[10px] text-ig-fg-muted">{READINESS_DIMENSION_LABEL[d]}</div>
              <div className={cn('text-[11px] font-medium', STATE_TONE[readiness.dimensions[d]].text)}>
                {STATE_TONE[readiness.dimensions[d]].label}
              </div>
            </div>
          ))}
        </div>
        {/*
          A projeção de faturamento é rotulada como PROJEÇÃO, ali onde ela
          aparece. Sem o rótulo, "pré-requisito de faturamento: pronto" seria
          lido como "pode faturar" — e não pode: isso é Fase 7.
        */}
        <p className="mt-1.5 text-[10px] text-ig-fg-subtle">
          O pré-requisito de faturamento é uma projeção do que a medição sabe.
          Direito de faturar não é decidido aqui.
        </p>
      </div>

      {/* ── Por que não está pronto ── */}
      {readiness.reasons.length > 0 && (
        <div>
          <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
            O que falta
          </h4>
          <ul className="space-y-1">
            {readiness.reasons.map((r) => (
              <li key={r} className="flex items-start gap-2 text-[12px] text-ig-fg">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-ig-warning" />
                {readinessReasonLabel(r)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Exigências contratuais, com a fonte ── */}
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
          Exigências do contrato
        </h4>
        {requirements.length === 0 ? (
          <p className="text-[12px] text-ig-fg-subtle">
            As exigências desta medição ainda não foram resolvidas a partir da regra contratual.
          </p>
        ) : (
          <ul className="divide-y divide-ig-border-subtle/40">
            {requirements.map((q) => (
              <li key={q.id} className="flex items-start justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <div className="text-[12px] text-ig-fg">{REQUIREMENT_KIND_LABEL[q.requirement_kind]}</div>
                  {/*
                    A resposta a "por que o Apex está pedindo isso": cláusula,
                    página, vigência. Sem isso, a exigência vira burocracia sem
                    origem — e a primeira reação de quem a recebe é ignorá-la.
                  */}
                  <div className="text-[10px] text-ig-fg-subtle">
                    {q.source_reference ?? 'origem contratual não referenciada'}
                    {q.source_page ? `, p. ${q.source_page}` : ''}
                    {q.rule_effective_from ? ` · vigente desde ${fmtDate(q.rule_effective_from)}` : ''}
                  </div>
                </div>
                {q.requirement_certainty === 'unknown' ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-ig-warning">
                    <ShieldQuestion className="h-3 w-3" />
                    o contrato não diz
                  </span>
                ) : (
                  <span className={cn('shrink-0 text-[11px]',
                    q.satisfaction_state === 'VALIDATED' ? 'text-ig-success'
                      : q.satisfaction_state === 'PROVIDED' ? 'text-ig-accent'
                      : q.satisfaction_state === 'NOT_APPLICABLE' ? 'text-ig-fg-subtle'
                      : 'text-ig-warning')}>
                    {q.satisfaction_state === 'VALIDATED' ? 'validada'
                      : q.satisfaction_state === 'PROVIDED' ? 'fornecida, não validada'
                      : q.satisfaction_state === 'NOT_APPLICABLE' ? 'dispensada'
                      : 'faltando'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Evidência acquirida ── */}
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
          Evidência vinculada
        </h4>
        {evidence.length === 0 ? (
          <p className="text-[12px] text-ig-fg-subtle">Nenhuma evidência vinculada a esta medição.</p>
        ) : (
          <ul className="space-y-1">
            {evidence.map((e) => (
              <li key={e.id} className={cn('flex items-center justify-between gap-2 text-[12px]',
                e.revoked_at && 'opacity-50 line-through')}>
                <span className="min-w-0 truncate text-ig-fg">
                  {EVIDENCE_CLASS_LABEL[e.evidence_class]} · {e.source_type}
                </span>
                {/*
                  Evidência INFERIDA continua visivelmente inferida, com a
                  confiança à mostra, até que alguém a valide. É a diferença
                  entre "o Apex acha" e "a operação confirmou".
                */}
                {e.link_source === 'system_inferred' && (
                  <span className="shrink-0 text-[10px] text-ig-warning">
                    inferida{e.confidence ? ` · ${Math.round(Number(e.confidence) * 100)}%` : ''}
                  </span>
                )}
                {e.validation_state === 'validated' && (
                  <span className="shrink-0 text-[10px] text-ig-success">validada</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Aceite ── */}
      {m.accepted_at && (
        <div className="rounded border border-ig-success/30 bg-ig-success/5 p-2.5">
          <div className="flex items-center gap-2 text-[12px] text-ig-success">
            <FileCheck2 className="h-3.5 w-3.5" />
            Aceita em {fmtDate(m.accepted_at)}
          </div>
          <div className="mt-0.5 text-[11px] text-ig-fg-muted">
            Fonte: {m.acceptance_source ? ACCEPTANCE_SOURCE_LABEL[m.acceptance_source] : 'não registrada'}
          </div>
        </div>
      )}

      {/* ── Linha do tempo REAL ── */}
      <div>
        <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
          Histórico
        </h4>
        <ul className="space-y-1">
          {history
            // A anotação de proveniência é detalhe da mesma transição, e não um
            // acontecimento novo: repeti-la na linha do tempo criaria eventos
            // que não existiram.
            .filter((h) => h.transition !== 'provenance_note' && h.transition !== 'acceptance_provenance')
            .map((h) => (
              <li key={h.id} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-ig-fg-subtle">{fmtDate(h.recorded_at)}</span>
                <span className="text-ig-fg">
                  {h.from_state ? `${MEASUREMENT_STATUS_LABEL[h.from_state]} → ` : ''}
                  {MEASUREMENT_STATUS_LABEL[h.to_state]}
                </span>
                {h.actor_source !== 'human' && (
                  <span className="text-ig-fg-subtle">({h.actor_source})</span>
                )}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

export function ProjectMeasurementsTab({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ProjectMeasurementRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pkg, setPkg] = useState<MeasurementPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await listProjectMeasurements(projectId);
        if (!active) return;
        setRows(data);
        setSelectedId((prev) => prev ?? data[0]?.id ?? null);
      } catch (e) {
        if (active) setError(e instanceof MeasurementError ? e.message : String(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  const loadPackage = useCallback(async (id: string) => {
    try {
      setPkg(await getMeasurementPackage(id));
    } catch (e) {
      setError(e instanceof MeasurementError ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadPackage(selectedId);
  }, [selectedId, loadPackage]);

  /*
    Vivas primeiro; substituídas e canceladas no fim. Elas continuam visíveis
    — a supersessão é parte da história e escondê-la tornaria "por que este
    valor mudou?" impossível de responder na tela.
  */
  const ordered = useMemo(() => {
    const dead = new Set(['SUPERSEDED', 'CANCELLED']);
    return [...rows].sort((a, b) => Number(dead.has(a.status)) - Number(dead.has(b.status)));
  }, [rows]);

  if (loading) {
    return (
      <HudPanel>
        <div className="flex items-center gap-2 p-6 text-sm text-ig-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando medições…
        </div>
      </HudPanel>
    );
  }

  if (error) {
    return (
      <HudPanel>
        <div className="p-6 text-sm text-ig-danger">{error}</div>
      </HudPanel>
    );
  }

  if (ordered.length === 0) {
    return (
      <HudPanel>
        <HudEmptyState
          icon="custom"
          customIcon={<Ruler className="h-12 w-12" />}
          title="Nenhuma medição registrada"
          /*
            A ausência é EXPLICADA, e a explicação aponta para a causa provável.
            "Nenhuma medição" sozinho faz o gestor procurar o botão que falta,
            quando o que falta é o vínculo contratual ou o mapeamento da regra.
          */
          description={
            'Medições nascem da regra de medição do contrato, mapeada a uma etapa do cronograma. '
            + 'Sem vínculo Projeto↔Contrato ou sem mapeamento aprovado, o Apex não cria candidatos — '
            + 'e não inventa nenhum.'
          }
        />
      </HudPanel>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <HudPanel>
        <div className="border-b border-ig-border-subtle/60 px-3 py-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
            Medições ({ordered.length})
          </h3>
        </div>
        <div className="divide-y divide-ig-border-subtle/30">
          {ordered.map((m) => (
            <MeasurementRow
              key={m.id}
              m={m}
              selected={m.id === selectedId}
              onSelect={() => setSelectedId(m.id)}
            />
          ))}
        </div>
      </HudPanel>

      <HudPanel>
        <div className="p-3">
          {pkg ? <MeasurementPackageView pkg={pkg} /> : (
            <div className="flex items-center gap-2 text-sm text-ig-fg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando pacote…
            </div>
          )}
        </div>
      </HudPanel>
    </div>
  );
}
