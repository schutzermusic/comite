'use client';

/**
 * Documentos de ASO — acervo, leitura automática e curadoria.
 *
 * Esta é a tela PRIMÁRIA do controle de saúde ocupacional. O que sustenta o
 * indicador é o PDF aprovado aqui; o eSocial aparece como uma coluna ao lado,
 * e nada nela impede aprovar, usar ou controlar o documento.
 *
 * CADA LINHA SEPARA QUATRO COISAS QUE NÃO SÃO A MESMA
 *
 *   o que a máquina LEU do PDF          → coluna "Exame" e "Validade"
 *   DE ONDE veio a validade             → o chip declarada/inferida
 *   o que o RH DECIDIU sobre o papel    → coluna "Documento"
 *   o que o eSocial diz, se disser algo → coluna "eSocial"
 *
 * Fundir isso num "status ok/erro" deixaria a tela mais limpa e esconderia
 * exatamente a informação que sustenta a conclusão.
 *
 * Todo documento entra pendente de revisão, mesmo com leitura perfeita e mesmo
 * com o S-2220 conferindo: o que está em jogo é a validade legal de um exame de
 * saúde, e um extrator concordando consigo mesmo não é evidência de nada.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  Undo2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  HudBadge,
  HudButton,
  HudEmptyState,
  HudInput,
  HudKpiStrip,
  HudModal,
  HudPanel,
  HudSelect,
  HudStatusPill,
  HudTable,
  useHudToast,
  type HudTableColumn,
  type KpiItem,
} from '@/components/hud';
import { ASO_KIND_FROM_DOCUMENT_LABEL } from '@/lib/workforce/aso-extractor';
import { ASO_CONTROL_NOTICE } from '@/lib/workforce/aso-alerts';
import {
  ASO_DOCUMENT_STATUS_LABELS,
  ASO_ESOCIAL_STATUS_LABELS,
  ASO_RESULT_LABELS as RESULT_LABELS,
  ASO_VALIDITY_BASIS_LABELS,
} from '@/lib/workforce/aso-labels';
import type { AsoReviewSummary } from '@/lib/workforce/aso-summary';
import { AsoReviewSummaryCard } from './AsoReviewSummaryCard';
import type {
  AsoAcknowledgedCaution,
  AsoDocumentStatus,
  AsoFields,
  AsoReviewAction,
  AsoReviewEntry,
  AsoReviewStatus,
} from '@/lib/workforce/aso-review';

const NA = '—';

/** Chip curto da procedência da validade; a frase inteira vem do tooltip. */
const BASIS_CHIP: Record<string, 'success' | 'warning' | 'subtle'> = {
  declared_document: 'success',
  inferred_periodicity: 'warning',
  undetermined: 'subtle',
};

const KIND_OPTIONS = [
  { value: '', label: '—' },
  ...(Object.entries(ASO_KIND_FROM_DOCUMENT_LABEL) as [string, string][]).map(([value, label]) => ({
    value,
    label,
  })),
];

export interface AsoDocument {
  id: string;
  person_id: string | null;
  worker_name_raw: string | null;
  worker_registration: string | null;
  file_name: string;
  original_file_url: string | null;
  exam_date: string | null;
  exam_kind: string | null;
  exam_result: string | null;
  validity_date: string | null;
  validity_basis: 'declared_document' | 'inferred_periodicity' | 'undetermined';
  doctor_name: string | null;
  doctor_crm: string | null;
  clinic_name: string | null;
  company_name: string | null;
  company_cnpj: string | null;
  occupational_risks: string[];
  extracted_fields_json: AsoFields;
  reviewed_fields_json: AsoFields;
  extraction_method: 'text_layer' | 'ocr_ai' | 'manual';
  extraction_confidence: number | null;
  extraction_issues: { field: string; reason: string }[];
  esocial_event_id: string | null;
  esocial_match_status: 'not_imported' | 'matched' | 'divergent' | 'not_applicable';
  divergences: { field: string; label: string; document: string | null; esocial: string | null }[];
  divergence_summary: string | null;
  review_status: AsoReviewStatus;
  document_status: AsoDocumentStatus;
  review_history: AsoReviewEntry[];
  reviewed_at: string | null;
  signedUrl: string | null;
  /** Resumo de conferência, com o veredito do MESMO portão que o servidor aplica. */
  review: AsoReviewSummary;
  created_at: string;
}

function dateLabel(value: string | null | undefined): string {
  return value ? value.split('-').reverse().join('/') : NA;
}

/**
 * Trilha legível: quem enviou, o que a máquina leu, quem confirmou.
 *
 * `by: null` é a máquina, e a frase diz isso em palavras — "o sistema" —
 * porque um traço ou um id vazio na coluna de autor seria lido como dado
 * faltando, e não como "aqui não houve pessoa nenhuma", que é o fato.
 */
function trailLine(entry: AsoReviewEntry): string {
  const quando = entry.at.slice(0, 10).split('-').reverse().join('/');
  const quem = entry.by ? `usuário ${entry.by.slice(0, 8)}` : 'o sistema';

  switch (entry.action) {
    case 'upload':
      return `${quando} — enviado por ${quem}`;
    case 'extract': {
      const m = entry.extraction?.method;
      const como = m === 'ocr_ai' ? 'IA / OCR' : m === 'manual' ? 'entrada manual' : 'camada de texto';
      const conf = entry.extraction?.confidence;
      const pct = conf !== null && conf !== undefined ? ` · ${(conf * 100).toFixed(0)}% de confiança` : '';
      const ress = entry.extraction?.issueCount ? ` · ${entry.extraction.issueCount} ressalva(s)` : '';
      return `${quando} — campos extraídos por ${quem} (${como}${pct}${ress})`;
    }
    case 'approve':
      return `${quando} — confirmado por ${quem}${entry.approval?.mode === 'bulk' ? ' (em lote)' : ''}`;
    case 'reject':
      return `${quando} — rejeitado por ${quem}`;
    case 'request_correction':
      return `${quando} — devolvido para correção por ${quem}`;
    case 'edit':
      return `${quando} — campos corrigidos por ${quem}${entry.fields?.length ? `: ${entry.fields.join(', ')}` : ''}`;
    case 'reopen':
      return `${quando} — reaberto por ${quem}`;
    default:
      return `${quando} — ${entry.action}`;
  }
}

/**
 * Ressalvas que alguém reconheceu na aprovação vigente.
 *
 * Lê a ÚLTIMA entrada de `approve` da trilha — e não todas: reabrir e aprovar
 * de novo produz uma decisão nova, e mostrar as ressalvas de uma aprovação
 * revogada descreveria um estado que não existe mais.
 */
function acknowledgedCautions(d: AsoDocument): AsoAcknowledgedCaution[] {
  if (d.document_status !== 'approved') return [];
  const approvals = (d.review_history ?? []).filter((e) => e.action === 'approve' && e.approval);
  return approvals.at(-1)?.approval?.cautions ?? [];
}

/** ISO → dd/mm/aaaa para o formulário de correção. */
function toInputDate(value: string | null | undefined): string {
  return value ?? '';
}

interface EditState {
  document: AsoDocument;
  examDate: string;
  examKind: string;
  result: string;
  validityDate: string;
  workerName: string;
  doctorName: string;
  doctorCrm: string;
  clinicName: string;
  risks: string;
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
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bandeja de conferência do que acabou de ser enviado. */
  const [pending, setPending] = useState<AsoReviewSummary[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

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
        results?: {
          fileName: string; ok: boolean; message?: string; method?: string;
          review?: AsoReviewSummary;
        }[];
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha no envio');

      const results = json.results ?? [];
      const lidos = results.map((r) => r.review).filter((r): r is AsoReviewSummary => Boolean(r));
      const failed = results.filter((r) => !r.ok);
      const byAi = results.filter((r) => r.ok && r.method === 'ocr_ai').length;

      // A conferência abre AQUI, com o que acabou de ser lido. É o ponto do
      // fluxo: o RH tem o PDF fresco na cabeça agora, e não daqui a três dias
      // numa fila que ele abriria sem contexto.
      setPending(lidos);

      notify(
        lidos.length > 0 ? `${lidos.length} ASO(s) lido(s) — confira e confirme` : 'Nenhum ASO processado',
        {
          description: [
            byAi > 0 ? `${byAi} exigiu leitura por IA (provavelmente escaneado).` : null,
            failed.length > 0 ? `${failed.length} não passou: ${failed[0].message}` : null,
          ].filter(Boolean).join(' ') || undefined,
          variant: lidos.length > 0 ? 'success' : 'error',
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

  /**
   * Uma ação de revisão.
   *
   * O 422/428 do servidor não é erro de rede: é o portão recusando uma
   * confirmação que a tela não deveria ter oferecido. Mostrar o impeditivo tal
   * como ele veio é o que evita a mensagem genérica "falha ao revisar", que não
   * diz o que consertar.
   */
  async function review(id: string, action: AsoReviewAction, opts: { acknowledge?: boolean } = {}) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/workforce/aso-documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, acknowledge: opts.acknowledge }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        blockers?: { label: string; detail: string }[];
        cautions?: { label: string; detail: string }[];
      };
      if (!res.ok || !json.ok) {
        const impedimento = json.blockers?.[0] ?? json.cautions?.[0];
        throw new Error(impedimento ? `${impedimento.label}. ${impedimento.detail}` : json.error ?? 'Falha ao revisar');
      }

      if (action === 'approve') {
        notify('ASO confirmado e arquivado', {
          description: 'A confirmação ficou registrada em seu nome e o documento passa a controlar o vencimento.',
          variant: 'success',
        });
      }
      // Sai da bandeja de conferência: já foi decidido.
      setPending((list) => list.filter((p) => p.documentId !== id));
      await reload();
      onChanged?.();
    } catch (e) {
      notify('Não foi possível concluir', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Confirma em lote os documentos SEM ressalva nenhuma.
   *
   * A seleção é do usuário e o servidor recalcula a elegibilidade de cada linha
   * — a lista daqui é um pedido, não um veredito. O que volta em `skipped` é
   * mostrado, porque um lote que silenciosamente aprova menos do que se pediu
   * é pior que um lote que recusa.
   */
  async function approveBulk(ids: string[]) {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res = await fetch('/api/workforce/aso-documents/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds: ids }),
      });
      const json = (await res.json()) as {
        ok: boolean; approved?: number; approvedIds?: string[];
        skipped?: { documentId: string; reason: string }[]; error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Falha na confirmação em lote');

      const skipped = json.skipped ?? [];
      notify(`${json.approved ?? 0} ASO(s) confirmados`, {
        description: skipped.length > 0
          ? `${skipped.length} ficaram de fora: ${skipped[0].reason}`
          : 'Todos sem ressalva, confirmados em seu nome.',
        variant: 'success',
      });

      const done = new Set(json.approvedIds ?? []);
      setPending((list) => list.filter((p) => !done.has(p.documentId)));
      await reload();
      onChanged?.();
    } catch (e) {
      notify('Falha na confirmação em lote', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setBulkBusy(false);
    }
  }

  function openEdit(d: AsoDocument) {
    setEdit({
      document: d,
      examDate: toInputDate(d.exam_date),
      examKind: d.exam_kind ?? '',
      result: d.exam_result ?? '',
      validityDate: toInputDate(d.validity_date),
      workerName: d.worker_name_raw ?? '',
      doctorName: d.doctor_name ?? '',
      doctorCrm: d.doctor_crm ?? '',
      clinicName: d.clinic_name ?? '',
      risks: (d.occupational_risks ?? []).join('; '),
    });
  }

  async function saveEdit() {
    if (!edit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/workforce/aso-documents/${edit.document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit',
          fields: {
            examDate: edit.examDate || null,
            examKind: edit.examKind || null,
            result: edit.result || null,
            validityDate: edit.validityDate || null,
            workerName: edit.workerName || null,
            doctorName: edit.doctorName || null,
            doctorCrm: edit.doctorCrm || null,
            clinicName: edit.clinicName || null,
            occupationalRisks: edit.risks || null,
          },
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        fieldErrors?: { field: string; reason: string }[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.fieldErrors?.[0]?.reason ?? json.error ?? 'Falha ao salvar');
      }
      notify('Campos corrigidos', {
        description: 'A leitura original foi preservada; a correção fica registrada como manual.',
        variant: 'success',
      });
      setEdit(null);
      await reload();
      onChanged?.();
    } catch (e) {
      notify('Correção recusada', {
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  /** Só entra no lote quem não tem ressalva NENHUMA — nem as leves. */
  const bulkReady = useMemo(
    () => pending.filter((p) => p.readiness.eligibleForBulk),
    [pending],
  );

  const kpis: KpiItem[] = useMemo(() => {
    const pending = documents.filter((d) => d.document_status === 'pending_review').length;
    const approved = documents.filter((d) => d.document_status === 'approved').length;
    const attention = documents.filter(
      (d) => d.document_status === 'rejected' || d.document_status === 'needs_correction',
    ).length;
    const divergent = documents.filter((d) => d.esocial_match_status === 'divergent').length;
    const unlinked = documents.filter((d) => !d.person_id).length;
    return [
      { id: 'total', label: 'Documentos no acervo', value: documents.length, icon: <FileText className="h-4 w-4" /> },
      {
        id: 'approved', label: 'Aprovados', value: approved,
        deltaLabel: 'Únicos que controlam vencimento',
      },
      {
        id: 'pending', label: 'Pendentes de revisão', value: pending,
        variant: pending > 0 ? 'warning' : 'default',
        deltaLabel: unlinked > 0 ? `${unlinked} sem pessoa vinculada` : undefined,
      },
      {
        id: 'attention', label: 'Rejeitados / a corrigir', value: attention,
        variant: attention > 0 ? 'danger' : 'default',
      },
      {
        id: 'divergent', label: 'Divergem do eSocial', value: divergent,
        // Nunca danger: divergência é aviso de transmissão, não invalida o papel.
        variant: divergent > 0 ? 'warning' : 'default',
        deltaLabel: 'Conferência opcional',
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
                title="Abrir o PDF ORIGINAL (link temporário)"
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
        const basis = ASO_VALIDITY_BASIS_LABELS[d.validity_basis];
        return (
          <div>
            <p className="text-sm tabular-nums text-ig-fg-strong">{dateLabel(d.validity_date)}</p>
            <span title={basis.hint}>
              <HudBadge size="sm" variant={BASIS_CHIP[d.validity_basis]}>{basis.label}</HudBadge>
            </span>
          </div>
        );
      },
    },
    {
      key: 'documentStatus',
      header: 'Documento',
      cell: (d) => {
        const meta = ASO_DOCUMENT_STATUS_LABELS[d.document_status];
        return (
          <div className="space-y-1">
            <span title={meta.hint}>
              <HudStatusPill size="sm" variant={meta.tone}>{meta.label}</HudStatusPill>
            </span>
            {d.reviewed_at && (
              <p className="text-[11px] text-ig-fg-muted">
                confirmado em {dateLabel(d.reviewed_at.slice(0, 10))}
              </p>
            )}
            {/* Ressalva reconhecida na aprovação fica VISÍVEL, e não só gravada:
                é a diferença entre um ASO aprovado com lacuna conhecida e um
                aprovado por descuido, e quem lê a tabela precisa distingui-los
                sem abrir a trilha. */}
            {acknowledgedCautions(d).map((c) => (
              <p
                key={c.code}
                className="text-[11px] text-ig-fg-muted"
                title={`${c.message}\n\nReconhecido por ${c.acknowledged_by} em ${c.acknowledged_at}`}
              >
                ressalva aceita: {c.code === 'missing_validity' ? 'sem validade apurável' : c.code}
              </p>
            ))}
            {(d.review_history ?? []).length > 0 && (
              <details className="text-[11px] text-ig-fg-muted">
                <summary className="cursor-pointer select-none">trilha</summary>
                <ul className="mt-1 space-y-0.5">
                  {d.review_history.map((e, i) => (
                    <li key={`${e.at}-${e.action}-${i}`}>• {trailLine(e)}</li>
                  ))}
                </ul>
              </details>
            )}
            {d.document_status === 'pending_review' && d.review?.readiness.blockers[0] && (
              <p className="text-[11px] text-ig-warning" title={d.review.readiness.blockers[0].detail}>
                {d.review.readiness.blockers[0].label}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'esocial',
      header: 'eSocial (opcional)',
      cell: (d) => {
        const meta = ASO_ESOCIAL_STATUS_LABELS[d.esocial_match_status]
          ?? ASO_ESOCIAL_STATUS_LABELS.not_imported;
        return (
          <div className="space-y-1">
            <span title={meta.hint}>
              <HudStatusPill size="sm" variant={meta.tone}>{meta.label}</HudStatusPill>
            </span>
            {d.divergences.map((div) => (
              <p key={div.field} className="text-[11px] text-ig-warning">
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
            {d.extraction_method === 'ocr_ai'
              ? 'IA / OCR'
              : d.extraction_method === 'manual'
                ? 'manual'
                : 'camada de texto'}
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
      key: 'actions',
      header: 'Revisão',
      cell: (d) => {
        const busy = busyId === d.id;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <HudButton
              size="sm"
              variant="ghost"
              disabled={busy}
              leftIcon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => openEdit(d)}
            >
              Editar
            </HudButton>
            {d.document_status === 'approved' ? (
              <HudButton
                size="sm"
                variant="ghost"
                disabled={busy}
                leftIcon={<Undo2 className="h-3.5 w-3.5" />}
                onClick={() => void review(d.id, 'reopen')}
              >
                Reabrir
              </HudButton>
            ) : (
              <>
                {/* Três caminhos, e a diferença entre eles é deliberada:
                    - sem ressalva  → confirma daqui, um clique.
                    - com ressalva  → ABRE a conferência. A ciência exigida pelo
                      servidor tem de ser dada lendo a ressalva, e um botão de
                      tabela não mostra o que se está assumindo.
                    - com impeditivo → nada. O servidor recusaria, e um botão que
                      sempre falha ensina a ignorar o erro em vez de corrigir. */}
                {d.review?.readiness.eligibleForBulk && (
                  <HudButton
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    leftIcon={busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    onClick={() => void review(d.id, 'approve')}
                  >
                    Confirmar
                  </HudButton>
                )}
                {d.review?.readiness.eligibleForConfirmation &&
                  d.review.readiness.requiresAcknowledgement && (
                    <HudButton
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      leftIcon={<Eye className="h-3.5 w-3.5" />}
                      onClick={() => setPending([d.review])}
                    >
                      Conferir
                    </HudButton>
                  )}
                {d.document_status !== 'needs_correction' && (
                  <HudButton
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => void review(d.id, 'request_correction')}
                  >
                    Corrigir
                  </HudButton>
                )}
                {d.document_status !== 'rejected' && (
                  <HudButton
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    leftIcon={<XCircle className="h-3.5 w-3.5" />}
                    onClick={() => void review(d.id, 'reject')}
                  >
                    Rejeitar
                  </HudButton>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  if (!available) {
    return (
      <HudPanel elevation={2}>
        <HudEmptyState
          icon="alert"
          title="Documentos de ASO ainda não provisionados"
          description={message ?? 'Aplique as migrations 085 e 089 para habilitar o acervo de ASOs em PDF.'}
        />
      </HudPanel>
    );
  }

  return (
    <div className="space-y-6">
      <HudPanel
        title="Enviar ASOs em PDF"
        subtitle={ASO_CONTROL_NOTICE}
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
          <p className="max-w-3xl text-[11px] leading-relaxed text-ig-fg-muted">
            Pode enviar vários de uma vez. O <strong className="text-ig-fg-strong">arquivo original é
            guardado intacto</strong> — a leitura vira metadado separado, e corrigir um campo nunca
            altera o PDF. ASO escaneado (sem camada de texto) é lido por IA. Nenhum documento é aceito
            automaticamente: todos entram como{' '}
            <strong className="text-ig-fg-strong">pendentes de revisão</strong>, e o eSocial não é
            exigido em momento nenhum.
          </p>
        </div>
      </HudPanel>

      {/* ── Bandeja de conferência ──
          Aparece logo depois do envio e some conforme cada documento é
          decidido. É o que substitui a viagem até uma fila separada. */}
      {pending.length > 0 && (
        <HudPanel
          elevation={2}
          title={`Conferir e confirmar — ${pending.length} documento(s)`}
          subtitle="Compare com o PDF original ao lado e confirme. Nada é arquivado sem o seu clique."
          headerActions={
            <div className="flex items-center gap-2">
              {bulkReady.length > 1 && (
                <HudButton
                  size="sm"
                  variant="primary"
                  disabled={bulkBusy}
                  leftIcon={bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  onClick={() => void approveBulk(bulkReady.map((p) => p.documentId))}
                >
                  Confirmar os {bulkReady.length} sem ressalva
                </HudButton>
              )}
              <HudButton size="sm" variant="ghost" onClick={() => setPending([])}>
                Conferir depois
              </HudButton>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-[11px] leading-relaxed text-ig-fg-muted">
              {bulkReady.length > 0 && pending.length > bulkReady.length ? (
                <>
                  {pending.length - bulkReady.length} documento(s) têm ressalva e ficam de fora da
                  confirmação em lote — esses precisam ser olhados um a um. É deliberado: confirmar
                  em bloco é afirmar que não há nada de estranho, e não dá para afirmar isso sobre um
                  documento que já avisou que tem.
                </>
              ) : (
                <>
                  Fechar esta bandeja não perde nada: os documentos continuam no acervo abaixo,
                  aguardando confirmação.
                </>
              )}
            </p>
            {pending.map((summary) => (
              <AsoReviewSummaryCard
                key={summary.documentId}
                summary={summary}
                signedUrl={documents.find((d) => d.id === summary.documentId)?.signedUrl}
                busy={busyId === summary.documentId}
                onConfirm={(acknowledge) => void review(summary.documentId, 'approve', { acknowledge })}
                onReject={() => void review(summary.documentId, 'reject')}
                onEdit={() => {
                  const doc = documents.find((d) => d.id === summary.documentId);
                  if (doc) openEdit(doc);
                }}
              />
            ))}
          </div>
        </HudPanel>
      )}

      {documents.length > 0 && <HudKpiStrip kpis={kpis} columns={5} size="sm" />}

      <HudPanel
        title="Acervo de ASOs"
        subtitle="Documento e conferência com o eSocial são dois estados distintos — o segundo nunca bloqueia o primeiro"
      >
        <HudTable<AsoDocument>
          columns={columns}
          data={documents}
          keyExtractor={(d) => d.id}
          loading={!loaded}
          emptyState={
            <HudEmptyState
              icon="inbox"
              title="Nenhum ASO no acervo"
              description="Envie os PDFs dos atestados. Eles são a fonte primária do controle: a validade escrita no papel vale mais que qualquer inferência, e o acervo funciona sem nenhuma importação do eSocial."
              action={{ label: 'Selecionar PDFs', onClick: () => inputRef.current?.click() }}
            />
          }
        />
      </HudPanel>

      <HudModal
        isOpen={edit !== null}
        onClose={() => setEdit(null)}
        title="Corrigir campos lidos"
        subtitle={edit?.document.file_name}
        size="lg"
      >
        {edit && (
          <div className="space-y-3">
            <p className="text-[11px] leading-relaxed text-ig-fg-muted">
              A correção é gravada <strong className="text-ig-fg-strong">ao lado</strong> da leitura
              original, que fica preservada. Uma data de validade digitada aqui conta como{' '}
              <strong className="text-ig-fg-strong">declarada</strong> — você está lendo o papel que o
              extrator não conseguiu ler. Apagá-la devolve o campo à regra de periodicidade, ou a
              &ldquo;não apurável&rdquo; quando o tipo de exame não permite deduzir.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <HudInput
                label="Nome do trabalhador"
                value={edit.workerName}
                onChange={(e) => setEdit({ ...edit, workerName: e.target.value })}
              />
              <HudSelect
                label="Tipo de exame"
                value={edit.examKind}
                onChange={(v) => setEdit({ ...edit, examKind: v })}
                options={KIND_OPTIONS}
              />
              <HudInput
                label="Data do exame (dd/mm/aaaa ou aaaa-mm-dd)"
                value={edit.examDate}
                onChange={(e) => setEdit({ ...edit, examDate: e.target.value })}
                placeholder="10/03/2026"
              />
              <HudInput
                label="Válido até"
                value={edit.validityDate}
                onChange={(e) => setEdit({ ...edit, validityDate: e.target.value })}
                placeholder="10/03/2027"
              />
              <HudSelect
                label="Resultado"
                value={edit.result}
                onChange={(v) => setEdit({ ...edit, result: v })}
                options={[
                  { value: '', label: '—' },
                  { value: '1', label: 'Apto' },
                  { value: '2', label: 'Inapto' },
                ]}
              />
              <HudInput
                label="Clínica / laboratório"
                value={edit.clinicName}
                onChange={(e) => setEdit({ ...edit, clinicName: e.target.value })}
              />
              <HudInput
                label="Médico examinador"
                value={edit.doctorName}
                onChange={(e) => setEdit({ ...edit, doctorName: e.target.value })}
              />
              <HudInput
                label="CRM"
                value={edit.doctorCrm}
                onChange={(e) => setEdit({ ...edit, doctorCrm: e.target.value })}
              />
            </div>

            <HudInput
              label="Riscos ocupacionais (separados por ;)"
              value={edit.risks}
              onChange={(e) => setEdit({ ...edit, risks: e.target.value })}
              placeholder="ruído; poeira mineral"
            />

            {edit.document.extraction_issues.length > 0 && (
              <div className="rounded-md border border-ig-border-subtle p-2">
                <p className="mb-1 text-[11px] font-medium text-ig-fg-strong">Ressalvas da leitura</p>
                <ul className="space-y-0.5">
                  {edit.document.extraction_issues.map((i, idx) => (
                    <li key={`${i.field}-${idx}`} className="text-[11px] text-ig-fg-muted">
                      • {i.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <HudButton variant="secondary" onClick={() => setEdit(null)}>Cancelar</HudButton>
              <HudButton
                variant="primary"
                disabled={saving}
                leftIcon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                onClick={() => void saveEdit()}
              >
                Salvar correção
              </HudButton>
            </div>
          </div>
        )}
      </HudModal>
    </div>
  );
}
