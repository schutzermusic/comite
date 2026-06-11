'use client';

/**
 * "Importar cronograma MS Project" wizard (spec §3/§4).
 * Steps: 1 Upload → 2 Análise → 3 Pré-visualização → 4 Modo → 5 Confirmação.
 * Parse is stateless (server route); nothing is written until step 5.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  Sparkles,
  Table2,
  UploadCloud,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { HudBadge, HudButton, HudModal, useHudToast } from '@/components/hud';
import { uploadProjectFile } from '@/lib/services/projects';
import type { ConfirmImportResult, ParsePreview } from '@/lib/types/project-timeline';

const STEPS = ['Upload', 'Análise', 'Pré-visualização', 'Modo', 'Confirmação'] as const;

export interface ImportWizardProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onImported: (result: ConfirmImportResult) => void;
}

export function ImportWizard({ projectId, open, onClose, onImported }: ImportWizardProps) {
  const { notify } = useHudToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [hasExisting, setHasExisting] = useState(false);
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmImportResult | null>(null);

  const reset = useCallback(() => {
    setStep(0);
    setFile(null);
    setPreview(null);
    setError(null);
    setResult(null);
    setMode('new');
    setParsing(false);
    setConfirming(false);
  }, []);

  const handleClose = useCallback(() => {
    if (parsing || confirming) return;
    reset();
    onClose();
  }, [parsing, confirming, reset, onClose]);

  const acceptFile = useCallback((f: File | null) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) {
      setError('Apenas PDF exportado do MS Project é suportado.');
      return;
    }
    setError(null);
    setFile(f);
  }, []);

  const runParse = useCallback(async () => {
    if (!file) return;
    setParsing(true);
    setStep(1);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/projects/${projectId}/timeline/import/parse`, {
        method: 'POST',
        body: form,
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body?.error ?? `Falha ao analisar o PDF (HTTP ${res.status}).`);
      }
      setPreview(body.preview as ParsePreview);
      setHasExisting(Boolean(body.hasExistingTimeline));
      setMode(body.hasExistingTimeline ? 'update' : 'new');
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao analisar o PDF.');
      setStep(0);
    } finally {
      setParsing(false);
    }
  }, [file, projectId]);

  const runConfirm = useCallback(async () => {
    if (!preview || !file) return;
    setConfirming(true);
    setStep(4);
    setError(null);
    try {
      // Audit copy of the PDF in the project-files bucket (best-effort).
      let filePath: string | null = null;
      try {
        const uploaded = await uploadProjectFile(projectId, file, 'cronograma');
        filePath = uploaded.path;
      } catch (e) {
        console.error('[ImportWizard] PDF upload failed:', e instanceof Error ? e.message : e);
      }

      const res = await fetch(`/api/projects/${projectId}/timeline/import/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: preview.rows,
          fileHash: preview.fileHash,
          fileName: preview.fileName,
          filePath,
          mode,
          parserUsed: preview.parserUsed,
          warnings: preview.warnings,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body?.error ?? `Falha ao importar (HTTP ${res.status}).`);
      }
      const r = body as ConfirmImportResult;
      setResult(r);
      notify('Cronograma importado', {
        description: `${r.inserted} novas, ${r.updated} atualizadas, ${r.deactivated} desativadas (v${r.scheduleVersion}).`,
        variant: 'success',
      });
      onImported(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar o cronograma.');
      setStep(3);
    } finally {
      setConfirming(false);
    }
  }, [preview, file, projectId, mode, notify, onImported]);

  const diffCounts = useMemo(() => {
    const d = preview?.diff;
    return {
      added: d?.added.length ?? 0,
      updated: d?.updated.length ?? 0,
      unchanged: d?.unchanged.length ?? 0,
      removed: d?.removed.length ?? 0,
    };
  }, [preview]);

  return (
    <HudModal
      isOpen={open}
      onClose={handleClose}
      title="Importar cronograma MS Project"
      subtitle="PDF exportado do Microsoft Project (colunas Id, EDT, Nome da Tarefa, % concluída, Duração, Início, Término)"
      size="xl"
    >
      {/* Step rail */}
      <div className="flex items-center gap-2 mb-5">
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold',
                  i < step && 'bg-ig-accent-weak text-ig-accent border-ig-border-focus',
                  i === step && 'bg-ig-accent text-white border-ig-accent',
                  i > step && 'text-ig-fg-muted border-ig-border',
                )}
              >
                {i + 1}
              </span>
              <span className={cn('text-xs', i === step ? 'text-ig-fg font-medium' : 'text-ig-fg-muted')}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className="h-px flex-1 bg-ig-border" />}
          </React.Fragment>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-ig-border p-3 text-sm text-ig-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1 — Upload */}
      {step === 0 && (
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              acceptFile(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-10 text-center transition-colors',
              dragOver ? 'border-ig-accent bg-ig-accent-weak' : 'border-ig-border hover:border-ig-border-strong',
            )}
          >
            <UploadCloud className="h-8 w-8 text-ig-fg-muted" />
            <p className="text-sm text-ig-fg">
              {file ? file.name : 'Arraste o PDF aqui ou clique para selecionar'}
            </p>
            <p className="text-xs text-ig-fg-muted">Máximo 15MB · somente PDF</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <HudButton variant="ghost" onClick={handleClose}>
              Cancelar
            </HudButton>
            <HudButton variant="primary" disabled={!file} onClick={runParse} leftIcon={<FileUp className="h-4 w-4" />}>
              Analisar PDF
            </HudButton>
          </div>
        </div>
      )}

      {/* Step 2 — Parsing */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <Loader2 className="h-8 w-8 animate-spin text-ig-accent" />
          <p className="text-sm text-ig-fg">Lendo o cronograma…</p>
          <p className="text-xs text-ig-fg-muted">
            Extração determinística por posição de texto; IA é usada como reforço se necessário.
          </p>
        </div>
      )}

      {/* Step 3 — Preview */}
      {step === 2 && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <HudBadge variant={preview.parserUsed === 'ai' ? 'info' : 'primary'} size="sm">
              {preview.parserUsed === 'ai' ? (
                <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> Extração por IA</span>
              ) : (
                'Extração determinística'
              )}
            </HudBadge>
            <HudBadge variant="neutral" size="sm">{preview.stats.totalRows} linhas</HudBadge>
            <HudBadge variant="neutral" size="sm">{preview.stats.phases} fases</HudBadge>
            <HudBadge variant="neutral" size="sm">{preview.stats.tasks} tarefas</HudBadge>
            <HudBadge variant="neutral" size="sm">{preview.stats.milestones} marcos</HudBadge>
            {preview.stats.rowsWithIssues > 0 && (
              <HudBadge variant="warning" size="sm">{preview.stats.rowsWithIssues} com avisos</HudBadge>
            )}
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-lg border border-ig-border p-3 text-xs text-ig-warning space-y-1 max-h-24 overflow-y-auto">
              {preview.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
                </p>
              ))}
            </div>
          )}

          <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-ig-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-ig-bg-elevated text-ig-fg-muted">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">EDT</th>
                  <th className="px-3 py-2 font-medium">Nome da Tarefa</th>
                  <th className="px-3 py-2 font-medium text-right">%</th>
                  <th className="px-3 py-2 font-medium">Duração</th>
                  <th className="px-3 py-2 font-medium">Início</th>
                  <th className="px-3 py-2 font-medium">Término</th>
                  <th className="px-3 py-2 font-medium">Avisos</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={`${row.msProjectId}-${row.wbsCode}`} className="border-t border-ig-border">
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-ig-fg-muted">{row.wbsCode}</td>
                    <td
                      className={cn('px-3 py-1.5', row.isSummary && 'font-semibold')}
                      style={{ paddingLeft: `${12 + Math.max(0, row.outlineLevel) * 14}px` }}
                    >
                      {row.isMilestone ? '◆ ' : ''}
                      {row.title || <span className="text-ig-fg-muted italic">(sem nome)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right">{row.percentComplete ?? '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{row.raw.original_duration_raw || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{row.raw.original_start_raw || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{row.raw.original_finish_raw || '—'}</td>
                    <td className="px-3 py-1.5">
                      {row.issues.length > 0 && (
                        <span className="text-ig-warning" title={row.issues.join('\n')}>
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between gap-2">
            <HudButton variant="ghost" onClick={reset}>
              Voltar
            </HudButton>
            <HudButton variant="primary" onClick={() => setStep(3)} leftIcon={<Table2 className="h-4 w-4" />}>
              Continuar
            </HudButton>
          </div>
        </div>
      )}

      {/* Step 4 — Mode + diff */}
      {step === 3 && preview && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3',
                mode === 'new' ? 'border-ig-accent bg-ig-accent-weak' : 'border-ig-border',
              )}
            >
              <input
                type="radio"
                name="import-mode"
                className="mt-1"
                checked={mode === 'new'}
                onChange={() => setMode('new')}
              />
              <span>
                <span className="block text-sm font-medium text-ig-fg">Importar como novo cronograma</span>
                <span className="block text-xs text-ig-fg-muted">
                  Todas as {preview.stats.totalRows} linhas entram como novas atividades, sem tocar nas existentes.
                </span>
              </span>
            </label>
            <label
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3',
                !hasExisting && 'opacity-50',
                hasExisting && 'cursor-pointer',
                mode === 'update' ? 'border-ig-accent bg-ig-accent-weak' : 'border-ig-border',
              )}
            >
              <input
                type="radio"
                name="import-mode"
                className="mt-1"
                disabled={!hasExisting}
                checked={mode === 'update'}
                onChange={() => setMode('update')}
              />
              <span>
                <span className="block text-sm font-medium text-ig-fg">Atualizar cronograma existente</span>
                <span className="block text-xs text-ig-fg-muted">
                  Combina por Id do MS Project + EDT; atividades removidas ficam inativas (nunca excluídas).
                </span>
              </span>
            </label>
          </div>

          {mode === 'update' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <HudBadge variant="success" size="sm">{diffCounts.added} novas</HudBadge>
                <HudBadge variant="info" size="sm">{diffCounts.updated} alteradas</HudBadge>
                <HudBadge variant="neutral" size="sm">{diffCounts.unchanged} sem mudança</HudBadge>
                <HudBadge variant="danger" size="sm">{diffCounts.removed} removidas</HudBadge>
              </div>
              {preview.diff.updated.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-ig-border p-3 text-xs space-y-1.5">
                  {preview.diff.updated.slice(0, 40).map((m) => (
                    <p key={`${m.existingItemId}-${m.wbsCode}`} className="text-ig-fg-muted">
                      <span className="font-mono text-ig-fg">{m.wbsCode}</span> {m.title} —{' '}
                      {m.changes.map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`).join('; ')}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2">
            <HudButton variant="ghost" onClick={() => setStep(2)}>
              Voltar
            </HudButton>
            <HudButton variant="primary" onClick={runConfirm}>
              {mode === 'update' ? 'Atualizar cronograma' : 'Importar cronograma'}
            </HudButton>
          </div>
        </div>
      )}

      {/* Step 5 — Confirmation */}
      {step === 4 && (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          {confirming ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-ig-accent" />
              <p className="text-sm text-ig-fg">Gravando cronograma…</p>
            </>
          ) : result ? (
            <>
              <CheckCircle2 className="h-10 w-10 text-ig-success" />
              <p className="text-sm font-medium text-ig-fg">Cronograma importado (versão {result.scheduleVersion})</p>
              <p className="text-xs text-ig-fg-muted">
                {result.inserted} novas · {result.updated} atualizadas · {result.deactivated} desativadas
              </p>
              <HudButton variant="primary" onClick={handleClose}>
                Concluir
              </HudButton>
            </>
          ) : null}
        </div>
      )}
    </HudModal>
  );
}
