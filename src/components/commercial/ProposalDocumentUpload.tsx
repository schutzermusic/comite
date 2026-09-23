"use client";

/**
 * Anexar o PDF de uma revisão — e ver, na hora, o que a leitura encontrou.
 *
 * O aviso de classificação (o documento diz ser outra coisa, ou outra
 * revisão) aparece aqui mesmo, ao lado do botão: é a pessoa que anexou quem
 * pode corrigir, e ela ainda está com o arquivo na mão.
 */
import { useState } from "react";
import { AlertTriangle, FileUp, Loader2 } from "lucide-react";
import { HudButton, useHudToast } from "@/components/hud";
import { uploadWithSignedToken } from "@/lib/commercial/upload-client";

export function ProposalDocumentUpload({
  proposalId, revisionId, revisionLabel, onDone,
}: { proposalId: string; revisionId: string; revisionLabel: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { success, error: notifyError } = useHudToast();

  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setWarnings([]);
    try {
      const { path, sha256 } = await uploadWithSignedToken(`/api/commercial/proposals/${proposalId}/documents`,
        { action: "authorize" }, file);
      const response = await fetch(`/api/commercial/proposals/${proposalId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "register", revisionId, path, title: file.name, contentSha256: sha256 }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Documento recusado.");
      setWarnings(payload.warnings ?? []);
      if (payload.extraction === "done") {
        success(`PDF da ${revisionLabel} lido`, `${payload.facts} fato(s) com proveniência · revise antes de confirmar.`);
      } else if (payload.extraction === "failed") {
        notifyError("PDF registrado, leitura não concluída", payload.error);
      } else {
        success(`PDF da ${revisionLabel} registrado`);
      }
      onDone();
    } catch (e) {
      notifyError("Anexar PDF", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <label className="inline-flex">
        <input type="file" accept="application/pdf" hidden disabled={busy}
          aria-label={`Anexar PDF da ${revisionLabel}`} onChange={(e) => send(e.target.files?.[0])} />
        <HudButton variant="ghost" size="sm" disabled={busy}
          onClick={(e) => (e.currentTarget.previousElementSibling as HTMLInputElement | null)?.click()}>
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <FileUp size={13} aria-hidden />}
          {busy ? "Lendo…" : "Anexar PDF"}
        </HudButton>
      </label>
      {warnings.map((w) => (
        <p key={w} className="flow-footer-issue" role="status"><AlertTriangle size={12} aria-hidden /> {w}</p>
      ))}
    </div>
  );
}
