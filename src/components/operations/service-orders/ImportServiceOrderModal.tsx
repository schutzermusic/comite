'use client';

import { useEffect, useState } from 'react';
import { HudButton, HudModal } from '@/components/hud';
import { uploadWithSignedToken } from '@/lib/commercial/upload-client';
import { brl } from '../ui';

type Target = { id: string; title: string; counterparty_name: string | null; status: string;
  authorized_value: string | null; currency: string | null };

/**
 * "Importar OS" — o PDF de uma OS interna já emitida fora do Apex.
 *
 * O arquivo vai direto ao Storage (caminho gerado pelo servidor, dentro do
 * inquilino), vira documento canônico do trabalho autorizado, e a leitura
 * volta como LINHAS PENDENTES de revisão, cada uma com página e trecho. A OS
 * não é emitida aqui: ela nasce rascunho e é confrontada com a fonte regente.
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
      const uploaded = await uploadWithSignedToken('/api/operations/service-orders/upload', { action: 'authorize' }, file);
      if (!uploaded.sha256) throw new Error('Este navegador não calculou a impressão digital do PDF.');
      setStage('reading');
      const response = await fetch('/api/operations/service-orders/upload', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'register', engagementId, path: uploaded.path, fileName: file.name,
          contentSha256: uploaded.sha256, osNumber: osNumber.trim() || undefined }),
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
    <HudModal
      isOpen onClose={busy ? () => undefined : onClose} size="lg"
      title="Importar OS"
      subtitle="PDF de uma Ordem de Serviço interna já emitida. Ela será lida, estruturada e confrontada com a PT e a PC aceitas."
      footer={
        <div className="flex justify-end gap-2">
          <HudButton variant="ghost" onClick={onClose} disabled={busy}>Cancelar</HudButton>
          <HudButton variant="primary" disabled={!file || !engagementId || busy} onClick={submit}>
            {stage === 'uploading' ? 'Enviando…' : stage === 'reading' ? 'Lendo a OS…' : 'Importar'}
          </HudButton>
        </div>
      }
    >
      <div className="ops-form" data-testid="import-os-modal">
        <label>Trabalho autorizado
          <select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} disabled={busy}>
            <option value="">Selecione…</option>
            {(targets ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.counterparty_name ? `${t.counterparty_name} — ` : ''}{t.title}
                {t.status === 'AUTHORIZED' ? ` · ${brl(t.authorized_value, t.currency ?? 'BRL')}` : ' · em análise'}
              </option>
            ))}
          </select>
        </label>
        <div className="ops-form-row">
          <label>Número da OS (opcional)
            <input value={osNumber} onChange={(e) => setOsNumber(e.target.value)} disabled={busy}
              placeholder="Como consta no documento" />
          </label>
          <label>PDF da OS
            <input type="file" accept="application/pdf" disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {!canRead && (
          <p className="crm-tone-warning text-ig-caption">
            Sem a permissão de leitura de documentos, o PDF é registrado sem leitura da Apex — as linhas serão digitadas na revisão.
          </p>
        )}
        {stage === 'reading' && canRead && (
          <p className="crm-muted" role="status">A Apex está lendo a OS: cada linha volta com página e trecho do documento.</p>
        )}
        {error && <p className="ops-form-error" role="alert">{error}</p>}
      </div>
    </HudModal>
  );
}
