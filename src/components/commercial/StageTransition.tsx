"use client";

/**
 * O controle de MUDANÇA DE ETAPA.
 *
 * Três decisões de desenho, todas pela mesma razão — tornar o ato visível como
 * ato:
 *
 * 1. As etapas de destino vêm de `ALLOWED_STAGE_TRANSITIONS`, a mesma tabela
 *    que a rota e o banco usam. A tela não oferece o que seria recusado.
 * 2. O campo de motivo APARECE quando o destino exige, em vez de existir
 *    sempre e ser ignorado. Um campo opcional que às vezes é obrigatório
 *    ensina a preenchê-lo com "ok".
 * 3. Não há modal. Encerrar uma oportunidade é uma decisão consciente, mas não
 *    é perigosa nem irreversível do ponto de vista de dados — o histórico
 *    guarda tudo. Um diálogo extra aqui seria cerimônia, e cerimônia repetida
 *    vira clique automático.
 */
import { useState } from "react";
import { HudButton, HudInput, useHudToast } from "@/components/hud";
import { opportunityStageLabels } from "@/lib/commercial/labels";
import type { OpportunityStage } from "@/lib/commercial/types";
import { Filter } from "./workspace";

export function StageTransition({
  opportunityId,
  current,
  options,
  requiresReason,
  onDone,
}: {
  opportunityId: string;
  current: OpportunityStage;
  options: OpportunityStage[];
  requiresReason: OpportunityStage[];
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { success, error: notifyError } = useHudToast();

  const needsReason = !!target && requiresReason.includes(target as OpportunityStage);
  const blocked = !target || saving || (needsReason && !reason.trim());

  const submit = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/commercial/opportunities/${opportunityId}/stage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: target, reason: reason.trim() || null }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload?.error || "Não foi possível mudar a etapa.");
      }
      success(
        `Etapa: ${opportunityStageLabels[target as OpportunityStage]}`,
        `De ${opportunityStageLabels[current]}.`,
      );
      setTarget("");
      setReason("");
      onDone();
    } catch (e) {
      notifyError("Mudança recusada", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="crm-stage-transition">
      <div className="crm-stage-transition-row">
        <Filter
          label="Mover para a etapa"
          value={target}
          onChange={setTarget}
          options={[
            { value: "", label: "Mover para…" },
            ...options.map((stage) => ({
              value: stage,
              label: opportunityStageLabels[stage],
            })),
          ]}
        />
        <HudButton variant="primary" size="sm" disabled={blocked} onClick={submit}>
          {saving ? "Registrando…" : "Registrar mudança"}
        </HudButton>
      </div>
      {needsReason && (
        <HudInput
          label="Motivo do encerramento"
          aria-label="Motivo do encerramento"
          required
          maxLength={500}
          value={reason}
          placeholder="Ex.: cliente optou pelo concorrente por prazo de entrega"
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <p className="crm-muted">
        Ganhar registra o resultado comercial. Autorizar a execução é um ato
        separado, com outra permissão e outra fonte — e o intervalo entre os
        dois fica visível de propósito.
      </p>
    </div>
  );
}
