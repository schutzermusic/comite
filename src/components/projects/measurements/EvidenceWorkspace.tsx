'use client';

/**
 * A BANCADA DE EVIDÊNCIA DE UM MARCO.
 *
 * ─── Por que ela existe no nível do MARCO, e não da medição ────────────────
 *
 * Porque a evidência chega antes da medição. O relatório de ensaio sai da
 * fábrica no dia do ensaio; a instância canônica de medição só nasce quando a
 * materialização governada roda. Pendurar o anexo na medição faria a operação
 * esperar por um registro de banco para guardar um PDF que já existe — e a
 * saída prática dessa espera é o arquivo no e-mail de alguém.
 *
 * Então o documento se liga ao MARCO, que é a identidade compartilhada, e ao
 * `measurement_id` também quando ele já existe.
 *
 * ─── O que esta bancada não faz ────────────────────────────────────────────
 *
 * Anexar não mede, não aceita e não torna elegível. Nenhum botão daqui chama
 * transição de medição. A linha embaixo da lista diz isso em voz alta porque
 * é a leitura errada mais provável da tela.
 */

import React, { useCallback, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, UploadCloud } from 'lucide-react';
import { HudButton, HudSelect, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import {
  EVIDENCE_CATEGORIES, EVIDENCE_CATEGORY_LABEL, linkExistingEvidence,
  signedEvidenceUrl, uploadMilestoneEvidence,
  type EvidenceCategory, type MilestoneEvidenceDocument,
} from '@/lib/projects/measurements/evidence-workspace';
import type { MilestoneWorkItem } from '@/lib/projects/milestone-worklist';

const fmtSize = (bytes: number | null): string => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export function EvidenceWorkspace({
  projectId, item, documents, onUploaded,
}: {
  readonly projectId: string;
  readonly item: MilestoneWorkItem;
  readonly documents: readonly MilestoneEvidenceDocument[];
  readonly onUploaded: () => void;
}) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<EvidenceCategory>('relatorio_medicao');
  const [uploading, setUploading] = useState(false);

  const canUpload = hasPermission('projects.documents.upload') || hasPermission('projects.upload');

  const handleFile = useCallback(async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadMilestoneEvidence({
        projectId,
        file,
        category,
        milestoneId: item.milestoneId,
        contractId: item.contractId,
        timelineItemId: item.timelineItemId,
        measurementId: item.measurementId,
      });
      /*
        Três desfechos, três frases. "Enviado" sem mais nada esconderia que o
        vínculo com a medição não aconteceu — e o gestor descobriria isso na
        prontidão da medição, dias depois, sem saber por quê.
      */
      if (result.linkedToMeasurement) {
        notify('Evidência anexada e vinculada à medição', { variant: 'success' });
      } else if (result.linkError) {
        notify('Documento salvo, mas não foi vinculado à medição', {
          description: result.linkError, variant: 'warning',
        });
      } else {
        notify('Evidência anexada ao marco', {
          description: 'A instância de medição ainda não existe; o vínculo será feito quando ela for criada.',
          variant: 'success',
        });
      }
      onUploaded();
    } catch (e) {
      notify('Falha ao anexar evidência', {
        description: e instanceof Error ? e.message : undefined, variant: 'error',
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [projectId, category, item, notify, onUploaded]);

  /*
    O documento que chegou antes da medição.

    Sem este botão a única saída da pessoa era subir o arquivo de novo depois
    que a medição nascesse — e aí existiriam dois objetos para o mesmo
    relatório, que é a duplicação que toda esta refatoração remove.
  */
  const link = useCallback(async (doc: MilestoneEvidenceDocument) => {
    if (!item.measurementId) return;
    try {
      await linkExistingEvidence(item.measurementId, doc);
      notify('Evidência vinculada à medição', { variant: 'success' });
      onUploaded();
    } catch (e) {
      notify('Não foi possível vincular à medição', {
        description: e instanceof Error ? e.message : undefined, variant: 'error',
      });
    }
  }, [item.measurementId, notify, onUploaded]);

  const open = useCallback(async (doc: MilestoneEvidenceDocument) => {
    const url = await signedEvidenceUrl(doc);
    if (url) window.open(url, '_blank', 'noreferrer');
    else notify('Não foi possível abrir o documento', { variant: 'error' });
  }, [notify]);

  return (
    <section className="space-y-2 border-t border-ig-border-subtle pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ig-fg-muted">
          Evidências
        </h3>
        {canUpload && (
          <div className="flex items-center gap-2">
            <HudSelect
              value={category}
              size="sm"
              fullWidth={false}
              className="min-w-[180px]"
              options={EVIDENCE_CATEGORIES.map((c) => ({
                value: c, label: EVIDENCE_CATEGORY_LABEL[c],
              }))}
              onChange={(value) => setCategory(value as EvidenceCategory)}
            />
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
            />
            <HudButton
              variant="primary"
              size="sm"
              isLoading={uploading}
              leftIcon={<UploadCloud className="h-4 w-4" />}
              onClick={() => inputRef.current?.click()}
            >
              Adicionar evidência
            </HudButton>
          </div>
        )}
      </div>

      {documents.length === 0 ? (
        <p className="text-[12px] text-ig-fg-subtle">
          {item.event.plan.evidenceRequired === true
            ? 'Nenhuma evidência anexada. O contrato exige evidência documental neste marco.'
            : 'Nenhuma evidência anexada a este marco.'}
        </p>
      ) : (
        <ul className="space-y-1">
          {documents.map((doc) => (
            <li key={doc.documentId} className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void open(doc)}
                className="flex min-w-0 items-center gap-2 text-left text-[12px] text-ig-accent hover:underline"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{doc.fileName}</span>
              </button>
              <span className="shrink-0 text-[10px] text-ig-fg-subtle">
                {doc.evidenceCategory ? EVIDENCE_CATEGORY_LABEL[doc.evidenceCategory] : 'Documento'}
                {' · '}{fmtDate(doc.uploadedAt)}
                {doc.fileSize ? ` · ${fmtSize(doc.fileSize)}` : ''}
                {/* O vínculo com a medição canônica, dito quando ele existe. */}
                {doc.measurementId ? ' · vinculado à medição' : ''}
              </span>
              {!doc.measurementId && item.measurementId && canUpload && (
                <button
                  type="button"
                  onClick={() => void link(doc)}
                  className="shrink-0 text-[10px] text-ig-accent hover:underline"
                >
                  Vincular à medição
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-start gap-1.5 text-[10px] text-ig-fg-subtle">
        <Paperclip className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        O arquivo é gravado UMA vez e aparece também em Documentos do projeto. Anexar
        evidência não mede, não registra aceite e não torna o marco elegível para faturar.
      </p>

      {uploading && (
        <p className="flex items-center gap-1.5 text-[11px] text-ig-fg-muted">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Enviando…
        </p>
      )}
    </section>
  );
}
