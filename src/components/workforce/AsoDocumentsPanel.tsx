'use client';

/**
 * Documentos de ASO — upload, leitura automática e curadoria.
 *
 * Cada linha mostra três coisas que precisam ficar separadas na cabeça de quem
 * revisa: o que o sistema LEU do PDF, DE ONDE veio a validade (declarada no
 * papel ou inferida por nós) e o que DIVERGE do evento S-2220. Fundir isso num
 * "status ok/erro" faria a tela parecer mais limpa e esconderia exatamente a
 * informação que sustenta a conclusão.
 *
 * Todo documento entra pendente de revisão, mesmo com leitura perfeita: o que
 * está em jogo é a validade legal de um exame de saúde.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudKpiStrip,
  HudPanel,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { ASO_KIND_FROM_DOCUMENT_LABEL } from '@/lib/workforce/aso-extractor';

const NA = '—';

const RESULT_LABELS: Record<string, string> = { '1': 'Apto', '2': 'Inapto' };

const BASIS_META: Record<string, { label: string; variant: 'success' | 'warning' | 'subtle'; hint: string }> = {
  declared_document: {
    label: 'declarada',
    variant: 'success',
    hint: 'A data estava escrita no ASO — é fato do documento.',
  },
  inferred_periodicity: {
    label: 'inferida',
    variant: 'warning',
    hint: 'O documento não declarou validade; deduzida pela periodicidade anual da NR-7.',
  },
  undetermined: {
    label: 'não apurável',
    variant: 'subtle',
    hint: 'Nem o documento declarou, nem o tipo de exame permite deduzir. Não leia como "em dia".',
  },
};

const MATCH_META: Record<string, { label: string; variant: 'active' | 'warning' | 'error' | 'neutral' }> = {
  matched: { label: 'Confere com o eSocial', variant: 'active' },
  divergent: { label: 'Diverge do eSocial', variant: 'error' },
  no_esocial_event: { label: 'Sem evento no eSocial', variant: 'warning' },
  pending: { label: 'Não conferido', variant: 'neutral' },
};

export interface AsoDocument {
  id: string;
  person_id: string | null;
  worker_name_raw: string | null;
  file_name: string;
  exam_date: string | null;
  exam_kind: string | null;
  exam_result: string | null;
  valid_until: string | null;
  validity_basis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  doctor_name: string | null;
  extraction_method: 'deterministic' | 'ai' | 'manual';
  extraction_confidence: number | null;
  extraction_issues: { field: string; reason: string }[];
  esocial_event_id: string | null;
  match_status: 'pending' | 'matched' | 'divergent' | 'no_esocial_event';
  divergences: { field: string; label: string; document: string | null; esocial: string | null }[];
  status: 'pending_review' | 'confirmed' | 'rejected';
  signedUrl: string | null;
  created_at: string;
}

function dateLabel(value: string | null): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

export function AsoDocumentsPanel({ onChanged }: { onChanged?: () => void }) {
  const { notify } = useHudToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [documents, setDocuments] = useState<AsoDocument[]>([]);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/workforce/aso-documents');
      const json = (await res.json()) as {
        ok: boolean; available?: boolean; documents?: AsoDocument[]; message?: string; error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao carregar documentos');
      setAvailable(json.available !== false);
      setMessage(json.message ?? null);
      setDocuments(json.documents ?? []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha ao carregar documentos');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('files', file);

      const res = await fetch('/api/workforce/aso-documents', { method: 'POST', body: form });
      const json = (await res.json()) as {
        ok: boolean;
        results?: { fileName: string; ok: boolean; message?: string; method?: string }[];
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha no envio');

      const results = json.results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      const byAi = results.filter((r) => r.ok && r.method === 'ai').length;

      notify(
        okCount > 0 ? `${okCount} ASO(s) lido(s)` : 'Nenhum ASO processado',
        {
          description: [
            byAi > 0 ? `${byAi} exigiu leitura por IA (provavelmente escaneado).` : null,
            failed.length > 0 ? `${failed.length} não passou: ${failed[0].message}` : null,
            okCount > 0 ? 'Todos entram como pendentes de revisão.' : null,
          ].filter(Boolean).join(' '),
          variant: okCount > 0 ? 'success' : 'error',
        },
      );

      await reload();
      onChanged?.();
    } catch (e) {
      notify('Falha ao enviar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function review(id: string, status: 'confirmed' | 'rejected') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/workforce/aso-documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha ao revisar');
      await reload();
      onChanged?.();
    } catch (e) {
      notify('Falha ao revisar', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const kpis: KpiItem[] = useMemo(() => {
    const pending = documents.filter((d) => d.status === 'pending_review').length;
    const divergent = documents.filter((d) => d.match_status === 'divergent').length;
    const noEvent = documents.filter((d) => d.match_status === 'no_esocial_event').length;
    const unlinked = documents.filter((d) => !d.person_id).length;
    return [
      { id: 'total', label: 'Documentos enviados', value: documents.length, icon: <FileText className="h-4 w-4" /> },
      {
        id: 'pending', label: 'Pendentes de revisão', value: pending,
        variant: pending > 0 ? 'warning' : 'default',
      },
      {
        id: 'divergent', label: 'Divergem do eSocial', value: divergent,
        variant: divergent > 0 ? 'danger' : 'default',
        deltaLabel: 'Erro de transmissão a corrigir',
      },
      {
        id: 'noEvent', label: 'Sem evento no eSocial', value: noEvent,
        variant: noEvent > 0 ? 'warning' : 'default',
        deltaLabel: unlinked > 0 ? `${unlinked} sem pessoa vinculada` : 'S-2220 não encontrado',
      },
    ];
  }, [documents]);

  const columns: HudTableColumn<AsoDocument>[] = [
    {
      key: 'worker',
      header: 'Colaborador / arquivo',
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ig-fg-strong">
            {d.worker_name_raw ?? 'Não identificado no documento'}
          </p>
          <p className="flex items-center gap-1 truncate text-xs text-ig-fg-muted">
            {d.file_name}
            {d.signedUrl && (
              <a
                href={d.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ig-accent hover:underline"
                title="Abrir o PDF (link temporário)"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
          {!d.person_id && (
            <HudBadge size="sm" variant="warning">sem pessoa vinculada</HudBadge>
          )}
        </div>
      ),
    },
    {
      key: 'exam',
      header: 'Exame',
      cell: (d) => (
        <div>
          <p className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(d.exam_date)}</p>
          <p className="text-xs text-ig-fg-muted">
            {d.exam_kind ? ASO_KIND_FROM_DOCUMENT_LABEL[d.exam_kind as '0'] ?? d.exam_kind : NA}
            {d.exam_result ? ` · ${RESULT_LABELS[d.exam_result] ?? d.exam_result}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'validity',
      header: 'Validade',
      cell: (d) => {
        const basis = BASIS_META[d.validity_basis];
        return (
          <div>
            <p className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(d.valid_until)}</p>
            <span title={basis.hint}>
              <HudBadge size="sm" variant={basis.variant}>{basis.label}</HudBadge>
            </span>
          </div>
        );
      },
    },
    {
      key: 'match',
      header: 'Conferência',
      cell: (d) => {
        const meta = MATCH_META[d.match_status];
        return (
          <div className="space-y-1">
            <HudStatusPill size="sm" variant={meta.variant}>{meta.label}</HudStatusPill>
            {d.divergences.map((div) => (
              <p key={div.field} className="text-[11px] text-ig-danger">
                {div.label}: papel {div.document ?? NA} × eSocial {div.esocial ?? NA}
              </p>
            ))}
          </div>
        );
      },
    },
    {
      key: 'reading',
      header: 'Leitura',
      cell: (d) => (
        <div>
          <HudBadge size="sm" variant={d.extraction_method === 'manual' ? 'info' : 'subtle'}>
            {d.extraction_method === 'ai' ? 'IA' : d.extraction_method === 'manual' ? 'manual' : 'automática'}
          </HudBadge>
          {d.extraction_confidence !== null && d.extraction_method !== 'manual' && (
            <p className="mt-0.5 text-[11px] tabular-nums text-ig-fg-muted">
              {(d.extraction_confidence * 100).toFixed(0)}% de confiança
            </p>
          )}
          {d.extraction_issues.length > 0 && (
            <p
              className="mt-0.5 flex items-center gap-1 text-[11px] text-ig-warning"
              title={d.extraction_issues.map((i) => i.reason).join('\n')}
            >
              <AlertTriangle className="h-3 w-3" />
              {d.extraction_issues.length} ressalva(s)
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Revisão',
      cell: (d) =>
        d.status === 'pending_review' ? (
          <div className="flex items-center gap-1">
            <HudButton
              size="sm"
              variant="ghost"
              disabled={busyId === d.id}
              leftIcon={busyId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              onClick={() => void review(d.id, 'confirmed')}
            >
              Confirmar
            </HudButton>
            <HudButton
              size="sm"
              variant="ghost"
              disabled={busyId === d.id}
              leftIcon={<XCircle className="h-3.5 w-3.5" />}
              onClick={() => void review(d.id, 'rejected')}
            >
              Rejeitar
            </HudButton>
          </div>
        ) : (
          <HudStatusPill size="sm" variant={d.status === 'confirmed' ? 'active' : 'neutral'}>
            {d.status === 'confirmed' ? 'Confirmado' : 'Rejeitado'}
          </HudStatusPill>
        ),
    },
  ];

  if (!available) {
    return (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="alert"
          title="Documentos de ASO ainda não provisionados"
          description={message ?? 'Aplique a migration 085 para habilitar o envio de ASOs em PDF.'}
        />
      </HudPanel>
    );
  }

  return (
    <div className="space-y-6">
      <HudPanel
        title="Enviar ASOs em PDF"
        subtitle="O sistema lê data, tipo, resultado e validade — e confere com o evento S-2220"
        icon={<Upload className="h-4 w-4" />}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <HudButton
            variant="primary"
            disabled={uploading}
            leftIcon={uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? 'Lendo documentos…' : 'Selecionar PDFs'}
          </HudButton>
          <p className="text-[11px] leading-relaxed text-ig-fg-muted">
            Pode enviar vários de uma vez. ASO escaneado (sem camada de texto) é lido por IA.
            Nenhum documento é aceito automaticamente: todos entram como{' '}
            <strong className="text-ig-fg-strong">pendentes de revisão</strong>, porque o que está em
            jogo é a validade legal de um exame de saúde.
          </p>
        </div>
      </HudPanel>

      {documents.length > 0 && <HudKpiStrip kpis={kpis} columns={4} size="sm" />}

      <HudPanel title="Documentos" subtitle="Leitura automática, procedência da validade e conferência com o eSocial">
        <HudTable<AsoDocument>
          columns={columns}
          data={documents}
          keyExtractor={(d) => d.id}
          loading={!loaded}
          emptyState={
            <HudEmptyState
              icon="inbox"
              title="Nenhum ASO enviado"
              description="Envie os PDFs dos atestados. A validade escrita no papel substitui a inferência que hoje é feita a partir do tipo de exame."
              action={{ label: 'Selecionar PDFs', onClick: () => inputRef.current?.click() }}
            />
          }
        />
      </HudPanel>
    </div>
  );
}
