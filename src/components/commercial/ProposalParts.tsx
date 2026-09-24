"use client";

/**
 * Peças da proposta que aparecem na revisão do PDF, no cartão de revisão e no
 * dossiê: parcelas de pagamento, texto longo em itens, a etiqueta PT/PC e a
 * proveniência discreta. Uma forma só, em todo lugar.
 */
import { useState, type ReactNode } from "react";
import { ArrowRight, ChevronDown, FileText, Quote } from "lucide-react";
import { HudButton } from "@/components/hud";
import { structurePaymentTerms, chunkText } from "@/lib/commercial/payment-terms";
import {
  CONTEXT_STAGE_LABEL, revisionLabel,
  type ContextProposal, type ContextRevision, type ProposalContext,
} from "@/lib/commercial/proposal-context";
import { brl } from "./shared";
import "./commercial-proposal.css";

export type DocRole = "PT" | "PC" | "PT+PC";

export function DocTag({ role }: { role: DocRole }) {
  return <span className={`pc-doc-tag pc-doc-${role === "PT" ? "pt" : role === "PC" ? "pc" : "combined"}`}>{role}</span>;
}

/** "Apex · p.7" — visível, mas nunca mais alto que a informação. */
export function Provenance({ children }: { children: ReactNode }) {
  return <span className="pc-prov"><Quote size={10} aria-hidden />{children}</span>;
}

export function PaymentSchedule({
  text, total, currency, provenance, compact = false,
}: {
  text: string | null | undefined;
  total?: number | string | null;
  currency?: string | null;
  provenance?: ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const terms = structurePaymentTerms(text, total ?? null);
  if (!terms.original) return <p className="pc-empty">Condição de pagamento não declarada.</p>;
  const money = (v: number | null) => (v === null || !Number.isFinite(v) ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL", minimumFractionDigits: 2 }).format(v));
  return (
    <div className={`pc-pay${compact ? " pc-pay-compact" : ""}`} data-testid="payment-schedule">
      {terms.installments.length > 0 && (
        <div className="pc-table-scroll">
          <table className="pc-pay-table">
            <thead>
              <tr><th className="pc-num">%</th><th className="pc-num">Valor</th><th>Gatilho / marco</th><th>Prazo / condição</th></tr>
            </thead>
            <tbody>
              {terms.installments.map((i, n) => (
                <tr key={n}>
                  <td className="pc-num"><strong>{i.percent !== null ? `${i.percent.toLocaleString("pt-BR")}%` : "—"}</strong></td>
                  <td className="pc-num">
                    {money(i.amount)}
                    {i.amountDerived && <small title="Calculado: percentual × valor total da revisão">calc.</small>}
                  </td>
                  <td>{i.trigger}</td>
                  <td className="pc-muted">{i.condition ?? "—"}</td>
                </tr>
              ))}
            </tbody>
            {terms.percentTotal !== null && (
              <tfoot>
                <tr>
                  <td className="pc-num"><strong className={terms.complete ? undefined : "pc-warn"}>{terms.percentTotal.toLocaleString("pt-BR")}%</strong></td>
                  <td className="pc-num">{total !== null && total !== undefined && total !== "" ? money(Number(total)) : "—"}</td>
                  <td colSpan={2} className={terms.complete ? "pc-muted" : "pc-warn"}>
                    {terms.complete ? "Parcelas somam o total" : "As parcelas não somam 100% — confira no PDF"}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {terms.general.length > 0 && (
        <ul className="pc-pay-general">
          {terms.general.map((g) => <li key={g}>{g}</li>)}
        </ul>
      )}
      <button type="button" className="pc-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronDown size={12} aria-hidden /> Texto original{provenance ? <> · {provenance}</> : null}
      </button>
      {open && <blockquote className="pc-original">{terms.original}</blockquote>}
    </div>
  );
}

/** Texto longo em itens, com "mostrar tudo". */
export function ChunkedText({ text, max = 5, empty }: { text: string | null | undefined; max?: number; empty?: string }) {
  const [all, setAll] = useState(false);
  const { items } = chunkText(text, 40);
  if (!items.length) return <p className="pc-empty">{empty ?? "Não informado."}</p>;
  const shown = all ? items : items.slice(0, max);
  return (
    <div className="pc-chunks">
      <ul>{shown.map((item, n) => <li key={n}>{item}</li>)}</ul>
      {items.length > max && (
        <button type="button" className="pc-disclosure" aria-expanded={all} onClick={() => setAll(!all)}>
          <ChevronDown size={12} aria-hidden /> {all ? "Mostrar menos" : `Mais ${items.length - max} item(ns)`}
        </button>
      )}
    </div>
  );
}

/** Rótulo · valor, alinhado em grade. */
export function KeyValue({ label, value, hint, tone }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: "accent" | "success" | "warning" | "danger";
}) {
  return (
    <div className={`pc-kv${tone ? ` pc-kv-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

const ROLE_OF: Record<string, DocRole> = { TECHNICAL: "PT", COMMERCIAL: "PC", COMBINED: "PT+PC" };

/**
 * Lista de propostas de uma conta ou oportunidade — uma linha por CONTEXTO
 * (PT + PC juntas), com o documento e a revisão regente de cada lado.
 */
export function ProposalContextList<P extends ContextProposal, R extends ContextRevision>({
  contexts, onOpen, empty,
}: {
  contexts: ProposalContext<P, R>[];
  onOpen?: (proposalId: string) => void;
  empty: ReactNode;
}) {
  if (!contexts.length) return <p className="crm-section-empty">{empty}</p>;
  return (
    <ul className="crm-linked-list" data-testid="proposal-context-list">
      {contexts.map((ctx) => (
        <li key={ctx.key}>
          <FileText size={14} aria-hidden />
          <div className="min-w-0">
            <strong>{ctx.title}</strong>
            <p className="crm-muted pc-context-line">
              {ctx.members.map((m) => (
                <span key={m.proposal.id}>
                  <DocTag role={ROLE_OF[m.proposal.kind]} /> {m.proposal.proposal_number} {revisionLabel(m.governing?.revision)}
                </span>
              ))}
            </p>
            <p className="crm-muted">
              {CONTEXT_STAGE_LABEL[ctx.stage]} · {ctx.value !== null ? brl(ctx.value, ctx.currency) : "sem valor"}
              {ctx.internalApproval === "REAPPROVAL" ? " · nova revisão aguarda reaprovação" : ""}
            </p>
          </div>
          {onOpen && (
            <HudButton variant="ghost" size="sm" onClick={() => onOpen(ctx.primaryId)}>
              Abrir <ArrowRight size={13} aria-hidden />
            </HudButton>
          )}
        </li>
      ))}
    </ul>
  );
}
