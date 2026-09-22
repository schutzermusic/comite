"use client";

/**
 * As peças comuns dos três espaços de detalhe — oportunidade, proposta e conta.
 *
 * Elas existem porque os três respondem à MESMA anatomia: uma faixa de fatos
 * curtos no topo, seções densas embaixo, sinais determinísticos onde eles
 * importam, e uma linha do tempo no fim. Repetir essa anatomia em três
 * arquivos faria os três divergirem — e um CRM em que cada tela mostra data,
 * dinheiro e estado de um jeito diferente é exatamente o que cansa quem passa
 * o dia nele.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Info, Lock, ShieldAlert } from "lucide-react";
import { HudBadge } from "@/components/hud";
import type {
  PipelineSignal,
  PipelineSignalSeverity,
} from "@/lib/commercial/pipeline-signals";
import { PIPELINE_SIGNAL_LABEL } from "@/lib/commercial/pipeline-signals";
import "./commercial.css";

/** Um fato curto: rótulo em cima, valor embaixo, nunca uma frase. */
export function Fact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger";
}) {
  return (
    <div className={`crm-fact${tone && tone !== "neutral" ? ` crm-fact-${tone}` : ""}`}>
      <span className="crm-eyebrow">{label}</span>
      <strong>{value}</strong>
      {hint && <span className="crm-muted">{hint}</span>}
    </div>
  );
}

export function FactGrid({ children }: { children: ReactNode }) {
  return <div className="crm-facts">{children}</div>;
}

/** Seção do dossiê. `count` some quando é zero — contador zerado é ruído. */
export function Section({
  title,
  note,
  count,
  action,
  children,
}: {
  title: string;
  note?: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="crm-section">
      <header>
        <div className="min-w-0">
          <h4>
            {title}
            {count !== undefined && count > 0 && (
              <HudBadge variant="subtle" size="sm">
                {count}
              </HudBadge>
            )}
          </h4>
          {note && <p className="crm-muted">{note}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/**
 * O vazio de uma seção — uma linha, não um cartaz.
 *
 * Um dossiê tem sete seções, e sete ilustrações de estado vazio transformariam
 * a leitura em rolagem. A frase diz o que apareceria ali, e para.
 */
export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="crm-section-empty">{children}</p>;
}

/**
 * A seção que existe e você não pode ver.
 *
 * Deliberadamente diferente do vazio: "nenhuma divergência" e "você não tem
 * alçada para ver divergências" são respostas opostas, e mostrar a segunda
 * como a primeira é como um bloqueio vira invisível.
 */
export function SectionRestricted({ permission }: { permission: string }) {
  return (
    <p className="crm-section-restricted">
      <Lock size={13} aria-hidden />
      Esta seção exige a permissão <code>{permission}</code>. O conteúdo existe e
      não está sendo exibido — não confunda com ausência de registros.
    </p>
  );
}

const SIGNAL_ICON: Record<PipelineSignalSeverity, ReactNode> = {
  blocking: <ShieldAlert size={14} aria-hidden />,
  attention: <AlertTriangle size={14} aria-hidden />,
  info: <Info size={14} aria-hidden />,
};

/**
 * A lista de sinais.
 *
 * Cada item traz a regra que disparou, o que ela significa e o próximo passo.
 * Nenhum deles é uma recomendação genérica: todos vêm de `pipeline-signals.ts`,
 * que é aritmética sobre datas e estados — e por isso cada um pode ser
 * conferido por quem discordar.
 */
export function SignalList({
  signals,
  emptyLabel = "Nenhum sinal aberto. Prazos, próximas ações e validade em dia.",
}: {
  signals: PipelineSignal[];
  emptyLabel?: string;
}) {
  if (!signals.length) return <SectionEmpty>{emptyLabel}</SectionEmpty>;
  return (
    <ul className="crm-signals">
      {signals.map((signal, index) => (
        <li
          key={`${signal.kind}-${signal.opportunityId ?? signal.proposalId ?? index}`}
          className={`crm-signal crm-signal-${signal.severity}`}
        >
          <span className="crm-signal-icon">{SIGNAL_ICON[signal.severity]}</span>
          <div className="min-w-0">
            <strong>{signal.title}</strong>
            <p className="crm-muted">{signal.detail}</p>
            <p className="crm-signal-action">→ {signal.suggestedAction}</p>
          </div>
          <HudBadge
            variant={
              signal.severity === "blocking"
                ? "danger"
                : signal.severity === "attention"
                  ? "warning"
                  : "subtle"
            }
            size="sm"
          >
            {PIPELINE_SIGNAL_LABEL[signal.kind]}
          </HudBadge>
        </li>
      ))}
    </ul>
  );
}

/** Marcadores compactos para a linha da lista e o card do kanban. */
export function SignalDots({ signals }: { signals: PipelineSignal[] }) {
  if (!signals.length) return null;
  const blocking = signals.filter((s) => s.severity === "blocking").length;
  const attention = signals.filter((s) => s.severity === "attention").length;
  const info = signals.length - blocking - attention;
  return (
    <span
      className="crm-signal-dots"
      title={signals.map((s) => s.title).join("\n")}
      aria-label={`${signals.length} sinal(is): ${signals.map((s) => s.title).join("; ")}`}
    >
      {blocking > 0 && <i className="crm-dot-blocking">{blocking}</i>}
      {attention > 0 && <i className="crm-dot-attention">{attention}</i>}
      {info > 0 && <i className="crm-dot-info">{info}</i>}
    </span>
  );
}

export interface TimelineEntry {
  id: string;
  at: string | null;
  title: string;
  detail?: string | null;
  actor?: string | null;
  tone?: "neutral" | "accent" | "success" | "danger";
}

/**
 * A linha do tempo.
 *
 * Montada de registros que JÁ EXISTEM — eventos de etapa, carimbos das
 * revisões, acompanhamentos. Não há tabela de "atividade": uma seria a segunda
 * versão da história, alimentada por gravação paralela, e divergiria da
 * primeira no dia em que alguém esquecesse de escrever nela.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (!entries.length) {
    return <SectionEmpty>Nada registrado ainda.</SectionEmpty>;
  }
  return (
    <ol className="crm-timeline">
      {entries.map((entry) => (
        <li key={entry.id} className={`crm-timeline-${entry.tone ?? "neutral"}`}>
          <div className="crm-timeline-mark" aria-hidden />
          <div className="min-w-0">
            <strong>{entry.title}</strong>
            {entry.detail && <p className="crm-muted">{entry.detail}</p>}
            <p className="crm-timeline-meta">
              {entry.at ? formatMoment(entry.at) : "Data não registrada"}
              {entry.actor ? ` · ${entry.actor}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function formatMoment(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Data inválida";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "há 12 dias" / "em 3 dias" / "hoje" — sem biblioteca e sem ambiguidade. */
export function relativeDays(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "hoje";
  return days > 0 ? `há ${days} dia${days > 1 ? "s" : ""}` : `em ${-days} dia${-days > 1 ? "s" : ""}`;
}
