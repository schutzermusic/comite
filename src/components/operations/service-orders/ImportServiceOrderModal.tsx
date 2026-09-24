'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { uploadWithSignedToken } from '@/lib/commercial/upload-client';
import { Busy, SidePanel, money } from '@/components/ax';

type Target = { id: string; title: string; counterparty_name: string | null; status: string;
  authorized_value: string | null; currency: string | null };

/**
 * "Importar OS" — o PDF de uma OS interna já emitida fora do Apex.
 *
 * O arquivo vai direto ao Storage (caminho gerado pelo servidor, dentro do
 * inquilino), vira documento canônico do trabalho autorizado, e a leitura
 * volta como LINHAS PENDENTES de revisão, cada uma com página e trecho. A OS
 * não é emitida aqui: ela nasce rascunho e é confrontada com a PT e a PC.
 */
export function ImportServiceOrderModal({
  canRead, onClose, onImported,
}: { canRead: boolean; onClose: () => void; onImported: (serviceOrderId: string) => void }) {
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [engagementId, setEngagementId] = useState('');
  const [osNumber, setOsNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<'idle' | 'uploading' | 'reading'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const response = await fetch('/api/operations/service-orders/packages');
      const payload = await response.json().catch(() => null);
      if (!cancelled) setTargets(response.ok && payload?.ok ? payload.importTargets : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async () => {
    if (!file || !engagementId) return;
    setError(null);
    try {
      setStage('uploading');
      // O servidor baixa, confere a assinatura do PDF e calcula a impressão digital — o hash do navegador é só conferência.
      const uploaded = await uploadWithSignedToken('/api/operations/service-orders/upload', { action: 'authorize' }, file);
      setStage('reading');
      const response = await fetch('/api/operations/service-orders/upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'register', engagementId, path: uploaded.path, fileName: file.name,
          contentSha256: uploaded.sha256 ?? undefined, osNumber: osNumber.trim() || undefined }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error ?? 'Não foi possível registrar a OS.');
      onImported(payload.serviceOrderId);
    } catch (e) {
      setError((e as Error).message);
      setStage('idle');
    }
  };

  const busy = stage !== 'idle';
  return (
    <SidePanel open onClose={busy ? () => undefined : onClose} testId="import-os-modal" eyebrow="Ordens de Serviço · documento externo" title="Importar OS"
      meta={<span>PDF de uma OS interna já emitida. Ela será lida, estruturada e confrontada com a PT e a PC aceitas — linha a linha, com página e trecho.</span>}
      footer={<>
        <button type="button" className="ax-btn ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button type="button" className="ax-btn primary" disabled={!file || !engagementId || busy} onClick={submit}>
          <Busy on={busy}>{stage === 'uploading' ? 'Enviando…' : stage === 'reading' ? 'Lendo a OS…' : 'Importar'}</Busy></button>
      </>}>
      <div className="ax-form">
        <label className="ax-field"><span>Trabalho autorizado</span>
          <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={busy}>
            <option value="">Selecione…</option>
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.counterparty_name ? `${t.counterparty_name} — ` : ''}{t.title}
                {t.status === 'AUTHORIZED' ? ` · ${t.authorized_value ? money(Number(t.authorized_value), t.currency ?? 'BRL') : 'sem valor'}` : ' · em análise'}
              </option>
            ))}
          </select></label>
        <label className="ax-field"><span>Número da OS (opcional)</span>
          <input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} disabled={busy} placeholder="Como consta no documento" /></label>
        <label className="ax-field"><span>PDF da OS</span>
          <input type="file" accept="application/pdf" disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <small><FileText size={12} aria-hidden /> {file.name} · {(file.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB</small>}</label>
        {!canRead && <p className="ax-note">Sem a permissão de leitura de documentos, o PDF é registrado sem leitura da Apex — as linhas serão digitadas na revisão.</p>}
        {stage === 'reading' && canRead && <p className="ax-note" role="status">A Apex está lendo a OS: cada linha volta com página e trecho do documento.</p>}
        {error && <p className="ax-error-text" role="alert">{error}</p>}
      </div>
    </SidePanel>
  );
}
