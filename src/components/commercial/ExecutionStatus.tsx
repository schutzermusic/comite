"use client";

/**
 * O ESTADO do início de execução — e a exceção que não se esconde.
 *
 * Execução iniciada com documentação pendente aparece como faixa no topo da
 * oportunidade, com prazo, responsável e o efeito ("faturamento bloqueado").
 * Regularizar é um ato com evidência e nota escrita; a faixa só some quando
 * o banco diz que a pendência acabou.
 */
import { useId, useState, type FormEvent } from "react";
import { CheckCircle2, FileCheck2, ShieldAlert } from "lucide-react";
import { HudButton, HudInput, HudModal, useHudToast } from "@/components/hud";
import {
  AUTHORIZATION_BASIS_LABEL, DOCUMENTATION_STATE_LABEL, type AuthorizationBasis,
} from "@/lib/commercial/execution-start";
import { daysBetween } from "@/lib/commercial/stage-policy";
import { day } from "./shared";
import "./commercial-flow.css";

export interface ExecutionStartSummary {
  id: string; engagement_id: string; mode: "STANDARD" | "EXCEPTIONAL";
  authorization_type: AuthorizationBasis; authorization_date: string;
  authorization_reference: string | null; documentation_state: keyof typeof DOCUMENTATION_STATE_LABEL;
  exception_reason: string | null; regularization_owner_user_id: string | null;
  regularization_due_date: string | null; regularized_at: string | null;
  service_order_id: string | null; project_id: string | null;
  confirmed_by: string | null; confirmed_at: string;
}

export function ExecutionStatusBanner({
  start, owners, canRegularize, onRegularized,
}: {
  start: ExecutionStartSummary;
  owners: Record<string, string>;
  canRegularize: boolean;
  onRegularized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = start.documentation_state === "PENDING";
  const overdueDays = pending && start.regularization_due_date
    ? daysBetween(start.regularization_due_date, new Date()) ?? 0 : 0;
  const owner = start.regularization_owner_user_id
    ? owners[start.regularization_owner_user_id] ?? "Responsável não identificado" : "—";

  if (!pending) {
    return (
      <div className="flow-banner flow-banner-ok" data-testid="execution-status">
        <CheckCircle2 size={16} aria-hidden />
        <div className="min-w-0">
          <strong>{start.documentation_state === "REGULARIZED" ? "Documentação regularizada" : "Execução iniciada"}</strong>
          <p className="crm-muted">
            {AUTHORIZATION_BASIS_LABEL[start.authorization_type]} de {day(start.authorization_date)}
            {start.authorization_reference ? ` · ${start.authorization_reference}` : ""}
            {start.confirmed_by ? ` · confirmado por ${owners[start.confirmed_by] ?? "usuário da organização"}` : ""}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flow-banner flow-banner-danger" role="status" data-testid="execution-status">
        <ShieldAlert size={16} aria-hidden />
        <div className="min-w-0">
          <strong>{DOCUMENTATION_STATE_LABEL.PENDING}</strong>
          <p>
            Projeto em execução; <b>faturamento bloqueado</b> até a regularização.
            {" "}Responsável: {owner} · prazo {day(start.regularization_due_date)}
            {overdueDays > 0 ? ` · vencido há ${overdueDays} dia(s)` : ""}
          </p>
          {start.exception_reason && <p className="crm-muted">Motivo declarado: {start.exception_reason}</p>}
        </div>
        {canRegularize && (
          <HudButton variant="secondary" size="sm" onClick={() => setOpen(true)}>
            <FileCheck2 size={14} aria-hidden /> Regularizar
          </HudButton>
        )}
      </div>
      {open && (
        <RegularizeModal startId={start.id} onClose={() => setOpen(false)}
          onDone={() => { setOpen(false); onRegularized(); }} />
      )}
    </>
  );
}

function RegularizeModal({ startId, onClose, onDone }: { startId: string; onClose: () => void; onDone: () => void }) {
  const formId = useId();
  const [kind, setKind] = useState<"customer_po" | "customer_authorization">("customer_po");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { success } = useHudToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/execution-start/${startId}/regularize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceKind: kind, externalReference: reference.trim(), note: note.trim() }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Regularização recusada.");
      success("Documentação regularizada",
        payload.billing_events_recomputed ? `${payload.billing_events_recomputed} evento(s) de faturamento reavaliado(s).` : undefined);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={onClose} title="Regularizar documentação comercial" size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
          <HudButton variant="primary" type="submit" form={formId}
            disabled={saving || !reference.trim() || note.trim().length < 5}>
            {saving ? "Regularizando…" : "Regularizar"}
          </HudButton>
        </div>
      }>
      <form id={formId} className="crm-form" onSubmit={submit}>
        <label className="crm-field-label">
          <span>Evidência recebida</span>
          <select aria-label="Tipo de evidência" value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="customer_po">Pedido de compra (PO)</option>
            <option value="customer_authorization">Autorização formal do cliente</option>
          </select>
        </label>
        <HudInput label="Referência verificável" aria-label="Referência verificável" required maxLength={500}
          value={reference} placeholder="Ex.: PO 4500099999 de 24/09" onChange={(e) => setReference(e.target.value)} />
        <HudInput label="Nota de regularização" aria-label="Nota de regularização" required maxLength={2000}
          value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="crm-muted">
          A evidência passa a <strong>reger</strong> o trabalho no lugar da autorização declarada, com esta nota
          registrada. Se o valor dela divergir, a divergência abre e continua bloqueando.
        </p>
        {error && <p role="alert" className="crm-form-error">{error}</p>}
      </form>
    </HudModal>
  );
}
