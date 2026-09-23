"use client";

/**
 * O BLUEPRINT DE EXECUÇÃO — o que a proposta diz que será preciso fazer.
 *
 * Enquanto a proposta não está autorizada, isto é CONTEXTO DE PLANEJAMENTO:
 * não cria projeto, OS, medição, faturamento, recebível nem receita. A faixa
 * no topo diz isso. Cada item mostra se o fato de origem já foi confirmado
 * por gente; o que não foi aparece como tal.
 *
 * Sem blueprint gravado, a tela mostra a MESMA organização montada dos fatos
 * lidos (prévia), e quem tem alçada pode gravá-la.
 */
import { useState } from "react";
import { ClipboardList, Lock } from "lucide-react";
import { HudBadge, HudButton, useHudToast } from "@/components/hud";
import {
  BLUEPRINT_CATEGORY_LABEL, DOMAIN_TO_CATEGORY, type BlueprintCategory,
} from "@/lib/commercial/blueprint";
import { factValue, type FactLike } from "@/lib/commercial/proposal-compare";
import { SectionEmpty } from "./detail";
import "./commercial-flow.css";

export interface BlueprintRow {
  id: string; proposal_revision_id: string; status: string; generated_by: string; created_at: string;
  items: Array<{ id: string; category: BlueprintCategory; title: string; detail: string | null;
    source_fact_id: string | null; confidence: string | null; state: string }>;
}

const ORDER: BlueprintCategory[] = [
  "SCOPE", "DELIVERABLE", "REQUIREMENT", "MEASUREMENT_RULE", "EVIDENCE_REQUIREMENT",
  "DATE", "DEPENDENCY", "BILLING_CONDITION", "RISK",
];

export function BlueprintView({
  proposalId, revisionId, revisionLabel, authorized, blueprint, facts, canCreate, onCreated, openQuestions,
}: {
  proposalId: string; revisionId: string | null; revisionLabel: string; authorized: boolean;
  blueprint: BlueprintRow | null; facts: FactLike[]; canCreate: boolean; onCreated: () => void;
  openQuestions: string[];
}) {
  const [saving, setSaving] = useState(false);
  const { success, error: notifyError } = useHudToast();
  const confirmed = new Map(facts.map((f) => [f.id, ["CONFIRMED", "CORRECTED"].includes(f.confirmation_state)]));

  const groups = new Map<BlueprintCategory, Array<{ key: string; title: string; detail: string | null; confirmed: boolean }>>();
  if (blueprint) {
    for (const item of blueprint.items) {
      const list = groups.get(item.category) ?? [];
      list.push({ key: item.id, title: item.title, detail: item.detail,
        confirmed: item.source_fact_id ? confirmed.get(item.source_fact_id) ?? false : item.state === "ACCEPTED" });
      groups.set(item.category, list);
    }
  } else {
    for (const fact of facts.filter((f) => f.subject_id === revisionId && f.confirmation_state !== "REJECTED")) {
      const category = DOMAIN_TO_CATEGORY[fact.fact_domain];
      if (!category) continue;
      const list = groups.get(category) ?? [];
      list.push({ key: fact.id, title: fact.label, detail: factValue(fact),
        confirmed: ["CONFIRMED", "CORRECTED"].includes(fact.confirmation_state) });
      groups.set(category, list);
    }
  }

  const create = async () => {
    if (!revisionId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/commercial/proposals/${proposalId}/blueprint`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Blueprint recusado.");
      success("Blueprint gravado", `${payload.items} item(ns) a partir dos fatos lidos.`);
      onCreated();
    } catch (e) {
      notifyError("Blueprint", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="execution-blueprint">
      <div className="flow-compare-headline">
        {authorized ? (
          <span><HudBadge variant="success" size="sm">Autorizado</HudBadge> O blueprint pode alimentar a OS e o projeto pelo caminho governado.</span>
        ) : (
          <span><Lock size={12} aria-hidden /> <strong>Contexto de planejamento.</strong> Não cria projeto, OS, medição, faturamento nem receita — {revisionLabel} ainda não está autorizada.</span>
        )}
        {!blueprint && groups.size > 0 && <span className="crm-muted">Prévia montada dos fatos lidos</span>}
        {blueprint && <span className="crm-muted">Gravado {new Date(blueprint.created_at).toLocaleDateString("pt-BR")} · {blueprint.status}</span>}
      </div>
      {groups.size === 0 ? (
        <SectionEmpty>Nenhum fato lido desta revisão alimenta o blueprint. O silêncio do documento é respeitado: nada é suposto.</SectionEmpty>
      ) : (
        <div className="flow-blueprint">
          {ORDER.filter((category) => groups.get(category)?.length).map((category) => (
            <section key={category}>
              <h5><span>{BLUEPRINT_CATEGORY_LABEL[category]}</span><span>{groups.get(category)!.length}</span></h5>
              <ul>
                {groups.get(category)!.map((item) => (
                  <li key={item.key}>
                    <span className={`flow-tag ${item.confirmed ? "flow-tag-confirmed" : "flow-tag-pending"}`}>
                      {item.confirmed ? "confirmado" : "a confirmar"}
                    </span>
                    <span>{item.title}{item.detail ? `: ${item.detail}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {openQuestions.length > 0 && (
            <section>
              <h5><span>Pontos em aberto</span><span>{openQuestions.length}</span></h5>
              <ul>{openQuestions.map((q) => <li key={q}><span className="flow-tag flow-tag-planning">aberto</span><span>{q}</span></li>)}</ul>
            </section>
          )}
        </div>
      )}
      {!blueprint && canCreate && groups.size > 0 && (
        <div style={{ padding: "10px 14px" }}>
          <HudButton variant="secondary" size="sm" disabled={saving} onClick={create}>
            <ClipboardList size={14} aria-hidden /> {saving ? "Gravando…" : "Gravar blueprint desta revisão"}
          </HudButton>
        </div>
      )}
    </div>
  );
}
