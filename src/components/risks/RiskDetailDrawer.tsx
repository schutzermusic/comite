"use client";

import React from "react";
import { HudDrawer, HudStatusPill, HudProgressBar } from "@/components/hud";
import type { ExtendedRisk } from "./risk-types";
import { SEVERITY_LABELS, STATUS_LABELS, CATEGORY_LABELS } from "./risk-types";
import { computeAging, severityColor, severityVariant, statusVariant, fmtDate } from "./risk-utils";
import {
  AlertTriangle, BrainCircuit, Calendar, CheckCircle2, Clock, FileText, Gauge, History,
  ListChecks, MapPin, Shield, Target, User, ChevronRight, XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  risk: ExtendedRisk | null;
  isOpen: boolean;
  onClose: () => void;
  /** When true, surfaces the "Descartar sugestao IA" button for AI-origin risks. */
  canDismissAi?: boolean;
  onDismissAi?: (risk: ExtendedRisk, reason?: string) => void | Promise<void>;
  dismissing?: boolean;
}

/* ── Section wrapper ── */
function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-ig-fg-muted">
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
      </div>
      {children}
    </div>
  );
}

/* ── Key-value row ── */
function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] font-medium text-ig-fg-subtle">{label}</span>
      <span className="text-right text-[12px] font-medium text-ig-fg-strong">{children}</span>
    </div>
  );
}

export function RiskDetailDrawer({
  risk,
  isOpen,
  onClose,
  canDismissAi,
  onDismissAi,
  dismissing,
}: Props) {
  if (!risk) return null;
  const showDismissButton =
    !!canDismissAi && !!onDismissAi && risk.origin === "ai" && !risk.aiDismissed;

  const aging = computeAging(risk.createdAt);
  const pendingActions = risk.actions.filter((a) => a.status !== "done");
  const completedActions = risk.actions.filter((a) => a.status === "done");
  const progress = risk.actions.length > 0 ? Math.round((completedActions.length / risk.actions.length) * 100) : 0;

  return (
    <HudDrawer isOpen={isOpen} onClose={onClose} title={risk.title} subtitle={risk.id} width="520px">
      <div className="space-y-6">
        {/* ── Executive summary bar ── */}
        <div className="flex flex-wrap items-center gap-2">
          <HudStatusPill variant={severityVariant(risk.severity)} size="sm">
            {SEVERITY_LABELS[risk.severity]}
          </HudStatusPill>
          <HudStatusPill variant={statusVariant(risk.status)} size="sm">
            {STATUS_LABELS[risk.status]}
          </HudStatusPill>
          {risk.origin === 'ai' && (
            <HudStatusPill variant="info" size="sm">IA</HudStatusPill>
          )}
          {risk.aiDismissed && (
            <HudStatusPill variant="neutral" size="sm">IA descartada</HudStatusPill>
          )}
          <div className="ml-auto flex items-center gap-1.5 rounded-lg border border-ig-border-subtle px-2.5 py-1">
            <Gauge className="h-3.5 w-3.5" style={{ color: severityColor(risk.severity) }} />
            <span className="text-[13px] font-bold ig-tabular" style={{ color: severityColor(risk.severity) }}>
              {risk.level}
            </span>
          </div>
        </div>

        {/* ── Description ── */}
        <div className="rounded-lg border border-ig-border-subtle bg-ig-raised p-3">
          <p className="text-[12px] leading-relaxed text-ig-fg-default">{risk.description}</p>
        </div>

        {/* ── Core attributes ── */}
        <Section title="Atributos" icon={<Shield className="h-3.5 w-3.5" />}>
          <div className="rounded-lg border border-ig-border-subtle divide-y divide-ig-border-subtle">
            <KV label="Score (P × I)">{risk.probability} × {risk.impact} = {risk.level}</KV>
            <KV label="Severidade"><span style={{ color: severityColor(risk.severity) }}>{SEVERITY_LABELS[risk.severity]}</span></KV>
            <KV label="Categoria">{CATEGORY_LABELS[risk.category ?? ""] ?? risk.category}</KV>
            <KV label="Área">{risk.area}</KV>
            <KV label="Responsável">
              <span className="flex items-center gap-1"><User className="h-3 w-3 text-ig-fg-subtle" />{risk.responsibleName ?? "—"}</span>
            </KV>
            <KV label="Status"><HudStatusPill variant={statusVariant(risk.status)} size="sm">{STATUS_LABELS[risk.status]}</HudStatusPill></KV>
            <KV label="Aging">
              <span className={cn("font-mono ig-tabular", aging > 60 ? "text-ig-danger" : aging > 30 ? "text-ig-warning" : "text-ig-fg-strong")}>
                {aging}d
              </span>
            </KV>
            <KV label="Criado em">{fmtDate(risk.createdAt)}</KV>
            {risk.dueDate && <KV label="Prazo">{fmtDate(risk.dueDate)}</KV>}
            {risk.resolvedAt && <KV label="Resolvido em">{fmtDate(risk.resolvedAt)}</KV>}
          </div>
        </Section>

        {/* ── AI rationale (when origin=ai) ── */}
        {risk.origin === "ai" && (risk.aiRationale || risk.aiModel) && (
          <Section title="Análise IA" icon={<BrainCircuit className="h-3.5 w-3.5" />}>
            <div className="rounded-lg border border-ig-border-subtle bg-ig-raised p-3 space-y-2">
              {risk.aiRationale && (
                <p className="text-[12px] leading-relaxed text-ig-fg-default">
                  {risk.aiRationale}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-ig-fg-subtle">
                {risk.aiModel && <span>Modelo: <span className="text-ig-fg-muted">{risk.aiModel}</span></span>}
                {typeof risk.aiConfidence === "number" && (
                  <span>
                    Confiança:{" "}
                    <span className="text-ig-fg-muted ig-tabular">
                      {Math.round(risk.aiConfidence * 100)}%
                    </span>
                  </span>
                )}
                {risk.sourceModule && (
                  <span>Origem: <span className="text-ig-fg-muted">{risk.sourceModule}</span></span>
                )}
              </div>
              {risk.aiDismissed && (
                <div className="rounded border border-ig-border-subtle bg-ig-bg-canvas p-2 text-[11px] text-ig-fg-muted">
                  Descartada{risk.aiDismissedAt ? ` em ${fmtDate(risk.aiDismissedAt)}` : ""}
                  {risk.aiDismissalReason ? ` · motivo: ${risk.aiDismissalReason}` : ""}
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Mitigation plan ── */}
        {risk.mitigationPlan && (
          <Section title="Plano de mitigação" icon={<Target className="h-3.5 w-3.5" />}>
            <div className="rounded-lg border border-ig-border-subtle bg-ig-raised p-3">
              <p className="text-[12px] leading-relaxed text-ig-fg-default">{risk.mitigationPlan}</p>
            </div>
            {risk.nextAction && (
              <div className="flex items-start gap-2 rounded-lg border border-ig-accent-weak bg-ig-accent-weak/40 p-2.5">
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-accent" />
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ig-accent">Próxima ação</span>
                  <p className="mt-0.5 text-[12px] text-ig-fg-strong">{risk.nextAction}</p>
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── Action progress ── */}
        {risk.actions.length > 0 && (
          <Section title={`Ações (${completedActions.length}/${risk.actions.length})`} icon={<ListChecks className="h-3.5 w-3.5" />}>
            <HudProgressBar value={progress} variant={progress === 100 ? "success" : "default"} size="sm" />
            <div className="space-y-1.5 mt-2">
              {risk.actions.map((action) => (
                <div
                  key={action.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border p-2.5 text-[11px] transition-colors",
                    action.status === "done"
                      ? "border-ig-border-subtle bg-ig-raised text-ig-fg-muted line-through"
                      : action.status === "in_progress"
                        ? "border-ig-accent-weak bg-ig-accent-weak/30 text-ig-fg-strong"
                        : "border-ig-border-subtle text-ig-fg-default"
                  )}
                >
                  <CheckCircle2 className={cn("h-3.5 w-3.5 shrink-0",
                    action.status === "done" ? "text-ig-success" : action.status === "in_progress" ? "text-ig-accent" : "text-ig-fg-subtle"
                  )} />
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{action.title}</span>
                    <span className="text-ig-fg-muted">{action.assignee} · {fmtDate(action.dueDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Evidences ── */}
        {risk.evidences.length > 0 && (
          <Section title={`Evidências (${risk.evidences.length})`} icon={<FileText className="h-3.5 w-3.5" />}>
            <div className="space-y-1.5">
              {risk.evidences.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 rounded-lg border border-ig-border-subtle p-2.5 text-[11px]">
                  <FileText className="h-3.5 w-3.5 text-ig-fg-subtle shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="block font-medium text-ig-fg-strong truncate">{ev.name}</span>
                    <span className="text-ig-fg-muted">{ev.uploadedBy} · {fmtDate(ev.uploadedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── History timeline ── */}
        {risk.history.length > 0 && (
          <Section title="Histórico" icon={<History className="h-3.5 w-3.5" />}>
            <div className="relative space-y-0 pl-4 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-ig-border">
              {risk.history.map((entry) => (
                <div key={entry.id} className="relative pb-3 last:pb-0">
                  <span className="absolute left-[-11px] top-1.5 h-2 w-2 rounded-full border-2 border-ig-accent bg-ig-bg-canvas" />
                  <div className="text-[11px]">
                    <span className="font-medium text-ig-fg-strong">{entry.action}</span>
                    {entry.detail && <p className="mt-0.5 text-ig-fg-muted">{entry.detail}</p>}
                    <span className="mt-0.5 block text-ig-fg-subtle">
                      {entry.user} · {fmtDate(entry.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Quick actions ── */}
        <div className="flex flex-wrap gap-2 border-t border-ig-border-subtle pt-4">
          {[
            { label: "Adicionar ação", icon: ListChecks },
            { label: "Atualizar mitigação", icon: Target },
            ...(risk.status !== "resolved" ? [{ label: "Marcar como resolvido", icon: CheckCircle2 }] : []),
          ].map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-raised px-3 py-1.5 text-[11px] font-semibold text-ig-fg-muted transition-all hover:border-ig-accent hover:text-ig-accent hover:bg-ig-accent-weak"
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
          {showDismissButton && (
            <button
              type="button"
              disabled={dismissing}
              onClick={() => {
                const reason =
                  window.prompt(
                    "Motivo para descartar esta sugestao da IA? (opcional)",
                    "",
                  ) ?? undefined;
                void onDismissAi?.(risk, reason || undefined);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-ig-danger/40 bg-ig-danger/10 px-3 py-1.5 text-[11px] font-semibold text-ig-danger transition-all hover:bg-ig-danger/20 disabled:opacity-60"
            >
              <XCircle className="h-3.5 w-3.5" />
              {dismissing ? "Descartando…" : "Descartar IA"}
            </button>
          )}
        </div>
      </div>
    </HudDrawer>
  );
}
