'use client';

/**
 * DOCUMENTOS DO PROJETO — o acervo de execução, organizado, com procedência.
 *
 * ─── O que mudou, e por quê ────────────────────────────────────────────────
 *
 * Era uma tabela de `project_files` sem contexto: um PDF chamado "Relatório de
 * montagem.pdf" ficava ao lado de um cronograma importado, sem dizer de que
 * marco ele é evidência nem que existe documento contratual em outro módulo.
 * Quem procurava a evidência da medição não a achava aqui, e quem a anexava na
 * medição a subia de novo aqui. Dois objetos, um documento.
 *
 * Agora o acervo é UM: `project_document_read_model` (189). A evidência de
 * medição é a MESMA linha que a bancada de evidência gravou — mesmo
 * `document_id`, mesmo byte —, e o documento contratual aparece como
 * REFERÊNCIA, sem cópia e sem segundo caminho de download.
 *
 * ─── O que esta aba não é ──────────────────────────────────────────────────
 *
 * Não é repositório de documentos contratuais. Instrumento, aditivos,
 * garantias, anexos e propostas incorporadas pertencem a Contratos; aqui eles
 * só ficam visíveis, com o link que leva ao dono.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Loader2, Ruler, UploadCloud } from 'lucide-react';
import { HudBadge, HudButton, HudEmptyState, HudPanel, useHudToast } from '@/components/hud';
import { usePermissions } from '@/hooks/use-permissions';
import { uploadProjectFile } from '@/lib/services/projects';
import {
  documentUrl, listProjectDocuments,
} from '@/lib/projects/documents/project-documents-service';
import {
  ORIGIN_SHORT, SHELF_LABEL, groupByShelf, typeLabel,
  type ProjectDocument,
} from '@/lib/projects/documents/project-documents';
import { contractHref, measurementHref } from '@/lib/projects/cross-module-links';
import { cn } from '@/lib/utils';

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** O tom da procedência. Contratual é NEUTRO: é referência, não trabalho daqui. */
function OriginBadge({ doc }: { readonly doc: ProjectDocument }) {
  return (
    <HudBadge
      variant={doc.origin === 'MEASUREMENT_EVIDENCE' ? 'primary'
        : doc.origin === 'CONTRACT' ? 'neutral' : 'outline'}
      size="sm"
    >
      {ORIGIN_SHORT[doc.origin]}
    </HudBadge>
  );
}

function DocumentRow({
  doc, projectId, highlighted,
}: {
  readonly doc: ProjectDocument;
  readonly projectId: string;
  readonly highlighted: boolean;
}) {
  const { notify } = useHudToast();

  const open = useCallback(async () => {
    const url = await documentUrl(doc);
    if (url) window.open(url, '_blank', 'noreferrer');
    else notify('Este documento é lido no módulo Contratos', { variant: 'info' });
  }, [doc, notify]);

  const isContractual = doc.origin === 'CONTRACT';

  return (
    <tr className={cn('border-t border-ig-border hover:bg-ig-panel-hover', highlighted && 'bg-ig-accent/5')}>
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-ig-fg-muted" />
          {isContractual ? (
            <span className="text-ig-fg">{doc.title}</span>
          ) : (
            <button type="button" onClick={() => void open()} className="text-left text-ig-accent hover:underline">
              {doc.title}
            </button>
          )}
        </span>
        {/*
          A RELAÇÃO do documento, dita na própria linha. Sem ela, "Relatório de
          ensaio.pdf" é um arquivo solto — e a pergunta "de que marco é isto?"
          só se responde abrindo o PDF.
        */}
        <span className="mt-0.5 flex flex-wrap items-center gap-2 pl-6 text-[11px] text-ig-fg-subtle">
          <OriginBadge doc={doc} />
          {doc.contractMilestoneId && (
            <Link
              href={measurementHref(projectId, doc.contractMilestoneId)}
              className="inline-flex items-center gap-1 text-ig-accent hover:underline"
            >
              <Ruler className="h-3 w-3" aria-hidden /> Abrir medição
            </Link>
          )}
          {isContractual && doc.contractId && (
            <Link
              href={contractHref(doc.contractId)}
              className="inline-flex items-center gap-1 text-ig-accent hover:underline"
            >
              <ExternalLink className="h-3 w-3" aria-hidden /> Abrir em Contratos
            </Link>
          )}
        </span>
      </td>
      <td className="px-4 py-2 text-ig-fg-muted">{typeLabel(doc)}</td>
      <td className="px-4 py-2 text-ig-fg-muted">
        {/* Documento contratual não tem tamanho aqui: ele não é byte deste módulo. */}
        {isContractual ? '—' : fmtSize(doc.fileSize)}
      </td>
      <td className="px-4 py-2 text-ig-fg-muted">
        {new Date(doc.uploadedAt).toLocaleDateString('pt-BR')}
      </td>
    </tr>
  );
}

export function ProjectDocumentsView({
  projectId, focusMilestoneId = null,
}: {
  readonly projectId: string;
  readonly focusMilestoneId?: string | null;
}) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<readonly ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpload = hasPermission('projects.documents.upload') || hasPermission('projects.upload');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setDocs(await listProjectDocuments(projectId));
      setError(null);
    } catch (e) {
      // Falha de leitura não é acervo vazio, e a tela não pode dizer "nenhum
      // documento" sobre uma consulta que não respondeu.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadProjectFile(projectId, file, 'document');
      notify('Documento enviado', { variant: 'success' });
      await reload();
    } catch (e) {
      notify('Falha no upload', { description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const groups = useMemo(() => groupByShelf(docs), [docs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-ig-fg-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> Carregando documentos…
      </div>
    );
  }

  if (error) {
    return <HudEmptyState icon="file" title="Não foi possível carregar o acervo" description={error} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-ig-fg-subtle">
          Evidências anexadas em Medições &amp; Evidências aparecem aqui automaticamente —
          o arquivo é o mesmo, não uma cópia. Documentos contratuais são referências do
          módulo Contratos.
        </p>
        {canUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files?.[0] ?? null)}
            />
            <HudButton
              variant="primary"
              size="sm"
              isLoading={uploading}
              leftIcon={<UploadCloud className="h-4 w-4" />}
              onClick={() => inputRef.current?.click()}
            >
              Enviar documento
            </HudButton>
          </>
        )}
      </div>

      {groups.length === 0 ? (
        <HudEmptyState
          icon="file"
          title="Nenhum documento"
          description="Envie relatórios, ensaios, desenhos e procedimentos da execução. Evidências de medição e PDFs de cronograma importados aparecem aqui automaticamente."
        />
      ) : (
        groups.map((group) => (
          <HudPanel key={group.shelf}>
            <div className="flex items-baseline justify-between px-4 py-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-ig-fg-muted">
                {SHELF_LABEL[group.shelf]}
              </h3>
              <span className="text-[11px] text-ig-fg-subtle">{group.documents.length}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-ig-border">
              <table className="w-full text-sm">
                <thead className="bg-ig-bg-elevated text-xs text-ig-fg-muted">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium">Documento</th>
                    <th className="px-4 py-2 font-medium">Tipo</th>
                    <th className="px-4 py-2 font-medium">Tamanho</th>
                    <th className="px-4 py-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {group.documents.map((doc) => (
                    <DocumentRow
                      key={`${doc.origin}-${doc.documentId}`}
                      doc={doc}
                      projectId={projectId}
                      highlighted={
                        focusMilestoneId !== null && doc.contractMilestoneId === focusMilestoneId
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </HudPanel>
        ))
      )}
    </div>
  );
}
