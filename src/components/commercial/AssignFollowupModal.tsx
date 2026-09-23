"use client";

/**
 * Designar (ou redesignar) um acompanhamento a uma PESSOA da plataforma.
 *
 * Passa por `apex_followup_assign`: quem designou e quando ficam carimbados,
 * a história append-only registra a designação, e a pessoa recebe o aviso.
 * O responsável em texto livre, quando existia, é substituído — e o texto
 * antigo fica visível aqui, para ninguém perder de vista de quem era.
 */
import { useId, useState, type FormEvent } from "react";
import { UserCheck } from "lucide-react";
import { HudButton, HudInput, HudModal, useHudToast } from "@/components/hud";
import { PersonSelect } from "./people";

export function AssignFollowupModal({
  followup, currentLabel, onClose, onAssigned,
}: {
  followup: { id: string; goal: string; due_date: string | null; responsible_text: string | null; responsible_user_id: string | null };
  currentLabel: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const formId = useId();
  const [person, setPerson] = useState<string | null>(followup.responsible_user_id);
  const [due, setDue] = useState(followup.due_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { success } = useHudToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!person || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/commercial/followups/${followup.id}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ responsibleUserId: person, dueDate: due || null }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Designação recusada.");
      success("Responsável designado");
      onAssigned();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <HudModal isOpen onClose={onClose} title={followup.responsible_user_id ? "Redesignar acompanhamento" : "Designar responsável"}
      subtitle={followup.goal} size="sm"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
          <HudButton variant="primary" type="submit" form={formId}
            disabled={saving || !person || person === followup.responsible_user_id && due === (followup.due_date ?? "")}>
            <UserCheck size={15} aria-hidden /> {saving ? "Designando…" : "Designar"}
          </HudButton>
        </div>
      }>
      <form id={formId} className="crm-form" onSubmit={submit}>
        <p className="crm-muted">Hoje: <strong>{currentLabel}</strong>{followup.responsible_text && !followup.responsible_user_id ? " (texto livre, sem identidade)" : ""}</p>
        <PersonSelect label="Nova pessoa responsável" value={person} onChange={setPerson} required />
        <HudInput label="Prazo" aria-label="Prazo do acompanhamento" type="date" value={due}
          onChange={(e) => setDue(e.target.value)} />
        <p className="crm-muted">A pessoa recebe o aviso, e a designação entra na história do acompanhamento.</p>
        {error && <p role="alert" className="crm-form-error">{error}</p>}
      </form>
    </HudModal>
  );
}
