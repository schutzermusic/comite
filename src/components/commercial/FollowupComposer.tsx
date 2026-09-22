"use client";

/**
 * ABRIR um acompanhamento comercial — no motor canônico, não num segundo.
 *
 * O formulário é curto de propósito, e cada campo corresponde a uma coluna de
 * `apex_followups` (migration 156): objetivo, responsável, prazo, evidência
 * esperada e cadência de cobrança. Não há campo de "descrição livre" nem de
 * prioridade: os dois existiriam só para a tela, e um acompanhamento cujo
 * conteúdo o motor não entende é um post-it com banco de dados.
 *
 * A idempotência é gerada aqui e enviada no cabeçalho: o retry de rede não pode
 * virar dois compromissos com o mesmo cliente.
 */
import { useId, useMemo, useState, type FormEvent } from "react";
import { CalendarPlus } from "lucide-react";
import { HudButton, HudInput, HudModal, useHudToast } from "@/components/hud";
import { GovernanceNote } from "./workspace";

export type FollowupSubjectKind =
  | "commercial_opportunity"
  | "commercial_proposal"
  | "commercial_engagement"
  | "internal_service_order";

export interface FollowupSubject {
  kind: FollowupSubjectKind;
  id: string;
  label: string;
}

const SUBJECT_LABEL: Record<FollowupSubjectKind, string> = {
  commercial_opportunity: "Oportunidade",
  commercial_proposal: "Proposta",
  commercial_engagement: "Trabalho autorizado",
  internal_service_order: "Ordem de Serviço",
};

function idempotencyKey(subject: FollowupSubject): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `commercial-followup:${subject.kind}:${subject.id}:${random}`;
}

export function FollowupComposer({
  subject,
  onClose,
  onCreated,
}: {
  subject: FollowupSubject;
  onClose: () => void;
  onCreated: () => void;
}) {
  const formId = useId();
  const [goal, setGoal] = useState("");
  const [responsible, setResponsible] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [evidence, setEvidence] = useState("");
  const [cadence, setCadence] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { success } = useHudToast();

  // Gerada uma vez por abertura do formulário: reenviar o MESMO pedido depois
  // de uma falha de rede tem de cair no mesmo acompanhamento, e não abrir um
  // segundo.
  const key = useMemo(() => idempotencyKey(subject), [subject]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/followups", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({
          sourceKind: subject.kind,
          sourceId: subject.id,
          goal: goal.trim(),
          responsibleText: responsible.trim() || null,
          dueDate: dueDate || null,
          expectedEvidence: evidence.trim() || null,
          cadenceDays: cadence ? Number(cadence) : null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || "Não foi possível abrir o acompanhamento.");
      }
      success("Acompanhamento aberto", `${SUBJECT_LABEL[subject.kind]} · ${subject.label}`);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal
      isOpen
      onClose={onClose}
      title="Agendar follow-up"
      subtitle={`${SUBJECT_LABEL[subject.kind]} · ${subject.label}`}
      size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </HudButton>
          <HudButton
            variant="primary"
            type="submit"
            form={formId}
            disabled={saving || !goal.trim() || !responsible.trim()}
          >
            <CalendarPlus size={15} aria-hidden />
            {saving ? "Abrindo…" : "Abrir acompanhamento"}
          </HudButton>
        </div>
      }
    >
      <form id={formId} className="crm-form" onSubmit={submit}>
        <HudInput
          label="O que precisa acontecer"
          aria-label="O que precisa acontecer"
          required
          maxLength={500}
          value={goal}
          placeholder="Ex.: obter a resposta do cliente sobre a revisão R02"
          onChange={(e) => setGoal(e.target.value)}
        />
        <div className="crm-form-grid">
          <HudInput
            label="Responsável"
            aria-label="Responsável"
            required
            maxLength={200}
            value={responsible}
            onChange={(e) => setResponsible(e.target.value)}
          />
          <HudInput
            label="Prazo"
            aria-label="Prazo"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
        <HudInput
          label="Evidência esperada"
          aria-label="Evidência esperada"
          maxLength={1000}
          value={evidence}
          placeholder="Ex.: e-mail do cliente confirmando o aceite"
          onChange={(e) => setEvidence(e.target.value)}
        />
        <HudInput
          label="Cadência de cobrança (dias)"
          aria-label="Cadência de cobrança em dias"
          type="number"
          min={1}
          max={365}
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
        />
        {error && (
          <p role="alert" className="crm-form-error">
            {error}
          </p>
        )}
        <GovernanceNote>
          Este acompanhamento entra em <code>apex_followups</code> — o mesmo motor
          do pós-venda, com o mesmo histórico e a mesma regra de conclusão.
          Concluir exige verificação; cancelar é outro resultado, e a fila mostra
          os dois separados.
        </GovernanceNote>
      </form>
    </HudModal>
  );
}
