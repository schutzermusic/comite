"use client";

/**
 * Comparação de revisões e o cruzamento PT × PC.
 *
 * O cabeçalho responde o que importa em uma linha ("R$ 920 mil → R$ 850 mil ·
 * pagamento 30 → 45 dias · validade +15 dias"); a tabela mostra tudo, com o
 * que mudou primeiro e o que não mudou esmaecido. Nada aqui altera a revisão
 * regente — comparar não é decidir.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import {
  compareRevisions, crossCheckTechnicalCommercial, type ChangeKind, type FactLike, type RevisionLike,
} from "@/lib/commercial/proposal-compare";
import { SectionEmpty } from "./detail";
import "./commercial-flow.css";

const KIND_LABEL: Record<ChangeKind, string> = {
  modified: "Alterado", added: "Novo", removed: "Removido", unchanged: "Igual",
};

const r = (revision: RevisionLike) => `R${String(revision.revision).padStart(2, "0")}`;

export function RevisionComparison({
  revisions, facts, governingId, label,
}: { revisions: RevisionLike[]; facts: FactLike[]; governingId: string | null; label: string }) {
  const ordered = useMemo(() => [...revisions].sort((a, b) => a.revision - b.revision), [revisions]);
  const latest = ordered.at(-1);
  const [rightId, setRightId] = useState(latest?.id ?? "");
  const [leftId, setLeftId] = useState(ordered.at(-2)?.id ?? "");
  const [showUnchanged, setShowUnchanged] = useState(false);

  if (ordered.length < 2) {
    return <SectionEmpty>Só existe {ordered.length ? r(ordered[0]) : "nenhuma revisão"} — nada a comparar ainda.</SectionEmpty>;
  }
  const left = ordered.find((x) => x.id === leftId) ?? ordered.at(-2)!;
  const right = ordered.find((x) => x.id === rightId) ?? latest!;
  const changes = compareRevisions(left, right, facts);
  const visible = showUnchanged ? changes : changes.filter((c) => c.kind !== "unchanged");
  const material = changes.filter((c) => c.material && c.kind !== "unchanged");
  const headline = changes.filter((c) => ["total_value", "payment_terms", "validity_until"].includes(c.key) && c.kind !== "unchanged");
  const scopeChanged = changes.some((c) => (c.key === "scope_summary" || c.domain === "SCOPE") && c.kind !== "unchanged");

  return (
    <div data-testid="revision-comparison">
      <div className="flow-compare-pickers">
        <label className="crm-field-label">
          <span>De</span>
          <select aria-label={`${label} — revisão de origem`} value={left.id} onChange={(e) => setLeftId(e.target.value)}>
            {ordered.map((x) => <option key={x.id} value={x.id}>{r(x)}{x.id === governingId ? " · regente" : ""}</option>)}
          </select>
        </label>
        <ArrowRight size={14} aria-hidden style={{ marginBottom: 10 }} />
        <label className="crm-field-label">
          <span>Para</span>
          <select aria-label={`${label} — revisão de destino`} value={right.id} onChange={(e) => setRightId(e.target.value)}>
            {ordered.map((x) => <option key={x.id} value={x.id}>{r(x)}{x.id === governingId ? " · regente" : ""}</option>)}
          </select>
        </label>
        <label className="crm-field-label" style={{ minWidth: 0 }}>
          <span>&nbsp;</span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontWeight: 400 }}>
            <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
            Mostrar iguais
          </span>
        </label>
      </div>
      <div className="flow-compare-headline" aria-label="Resumo da comparação">
        <span><strong>{r(left)} → {r(right)}</strong></span>
        {headline.map((c) => (
          <span key={c.key}>{c.label}: {c.before ?? "—"} → <strong>{c.after ?? "—"}</strong>{c.delta ? ` (${c.delta})` : ""}</span>
        ))}
        <span>Escopo: <strong>{scopeChanged ? "alterado" : "inalterado"}</strong></span>
        <span className={material.length ? "flow-material" : "crm-muted"}>{material.length} mudança(s) material(is)</span>
      </div>
      {left.id === governingId && right.status !== "ACCEPTED" && (
        <p className="flow-note" style={{ margin: "10px 14px" }}>
          <Info size={13} aria-hidden /> {r(left)} continua regendo. {r(right)} só passa a valer quando for aceita pelo cliente — nada é sobrescrito em silêncio.
        </p>
      )}
      {visible.length === 0 ? (
        <SectionEmpty>Nenhuma diferença registrada entre {r(left)} e {r(right)}.</SectionEmpty>
      ) : (
        <div className="crm-table-scroll">
          <table className="flow-compare">
            <thead><tr><th>Item</th><th>{r(left)}</th><th>{r(right)}</th><th>Mudança</th></tr></thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.key} data-kind={c.kind}>
                  <td>
                    {c.label}
                    {c.material && <div className="flow-material">material</div>}
                    {c.unconfirmed && <div className="crm-muted">leitura não confirmada</div>}
                  </td>
                  <td className={c.kind === "modified" || c.kind === "removed" ? "flow-before" : undefined}>{c.before ?? "—"}</td>
                  <td className={c.kind === "modified" || c.kind === "added" ? "flow-after" : undefined}>
                    {c.after ?? "—"}
                    {c.delta && <span className="flow-delta">{c.delta}</span>}
                  </td>
                  <td><span className={`flow-kind flow-kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TechnicalCommercialCheck({
  technical, commercial, facts, technicalLabel, commercialLabel,
}: {
  technical: RevisionLike | null; commercial: RevisionLike | null; facts: FactLike[];
  technicalLabel: string; commercialLabel: string;
}) {
  if (!technical || !commercial) {
    return <SectionEmpty>Sem o par técnica + comercial nesta oportunidade — o cruzamento aparece quando as duas existirem.</SectionEmpty>;
  }
  const findings = crossCheckTechnicalCommercial({ technical, commercial, facts });
  return (
    <div data-testid="pt-pc-check">
      <p className="flow-compare-headline"><span><strong>{technicalLabel}</strong> × <strong>{commercialLabel}</strong></span></p>
      {findings.length === 0 ? (
        <SectionEmpty>Nada conferível diverge entre as duas. Isso não afirma que os escopos coincidem — só que valor, validade e cobertura não se contradizem.</SectionEmpty>
      ) : (
        <ul className="crm-signals">
          {findings.map((finding) => (
            <li key={finding.key} className={`crm-signal ${finding.severity === "attention" ? "crm-signal-attention" : ""}`}>
              <span className="crm-signal-icon">{finding.severity === "attention" ? <AlertTriangle size={14} aria-hidden /> : <Info size={14} aria-hidden />}</span>
              <div className="min-w-0">
                <strong>{finding.label}</strong>
                <p className="crm-muted">{finding.detail}</p>
              </div>
              <span />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
