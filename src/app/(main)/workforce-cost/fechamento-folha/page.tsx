'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  FileSpreadsheet, Upload, ScanLine, Sparkles, Paperclip, Send, Banknote,
  CheckCircle, AlertTriangle, ShieldAlert, Info, ArrowRight, Loader2,
  Link2, Plus, Save, Wand2, RefreshCw, X, Pencil, Trash2, RotateCcw, Replace,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudPanel, HudButton, HudKpiStrip, HudStatusPill,
  HudBadge, HudSelect, HudInput, HudModal, type KpiItem, type HudStatusPillVariant,
} from '@/components/hud';
import { batchActionRules, financeImpactWarning, type ActionRule } from '@/lib/payroll/batch-actions';
import { useHudToast } from '@/hooks/useHudToast';
import { parsePayrollWorkbook } from '@/lib/payroll/parser';
import {
  buildEmailHtml, buildEmailText, buildExecutiveReportHtml,
} from '@/lib/payroll/html-builder';
import * as closing from '@/lib/payroll/closing-client';
import {
  formatBRL, formatBytes, ATTACHMENT_TYPE_LABEL, SECURITY_LABEL, isSensitive,
  PACKAGE_PRESETS, requestNarrative,
} from '@/lib/payroll/client';
import { getCostCenters } from '@/lib/finance/finance-store';
import {
  autoMatchCostCenters, buildResolvedAliasIndex, buildFinanceHandoffLines,
  matchCostCenter, type CostCenterLike,
} from '@/lib/payroll/cost-center-mapping';
import type {
  PayrollClosingBatch, PayrollParseResult, PayrollNarrative, PayrollAttachment,
  PayrollEmailDispatch, PayrollImportFileType, PayrollCostCenterTotal,
  PayrollCostCenterMapping, CostCenterMatchMethod,
} from '@/lib/types/payroll-closing';

const STEPS = [
  { n: 1, label: 'Upload', icon: Upload },
  { n: 2, label: 'Validação', icon: ScanLine },
  { n: 3, label: 'Análise IA', icon: Sparkles },
  { n: 4, label: 'Anexos', icon: Paperclip },
  { n: 5, label: 'Envio', icon: Send },
  { n: 6, label: 'Financeiro', icon: Banknote },
] as const;

const UPLOAD_SLOTS: Array<{ type: PayrollImportFileType; label: string; accept: string; required?: boolean; hint?: string; sensitive?: boolean }> = [
  { type: 'payroll_spreadsheet', label: 'Planilha Geral da Folha', accept: '.xlsx,.xls,.csv', required: true, hint: 'Fonte numérica — Excel/CSV. PDF não é lido como número.' },
  { type: 'bank_payment_spreadsheet', label: 'Planilha Bancária / Pagamento', accept: '.xlsx,.xls,.csv,.pdf', sensitive: true, hint: 'PDF entra como anexo de apoio (parser lê Excel/CSV).' },
  { type: 'holerite', label: 'Holerites Internos', accept: '.pdf,.zip', sensitive: true, hint: 'PDFs (vários) ou .zip.' },
  { type: 'external_holerite', label: 'Holerites Externos / Avulsos', accept: '.pdf,.zip,.xlsx,.xls', sensitive: true },
  { type: 'supporting_document', label: 'Documentos de Apoio', accept: '.pdf,.xlsx,.xls,.csv,.zip,.png,.jpg,.jpeg' },
];

/** Slot type → the attachment file_type its uploads carry (IMPORT_TYPE_MAP). */
const SLOT_ATTACHMENT_TYPE: Record<PayrollImportFileType, string> = {
  payroll_spreadsheet: 'payroll_spreadsheet',
  bank_payment_spreadsheet: 'bank_payment_spreadsheet',
  holerite: 'holerite',
  external_holerite: 'external_holerite',
  supporting_document: 'supporting_document',
};

const STATUS_VARIANT: Record<PayrollClosingBatch['status'], HudStatusPillVariant> = {
  imported: 'neutral',
  validated: 'info',
  reviewed: 'pending',
  approved: 'completed',
  sent_to_finance: 'completed',
  posted: 'completed',
  cancelled: 'error',
};

/** How a cost-center link was resolved → human label for the status column. */
const MATCH_LABEL: Record<CostCenterMatchMethod, string> = {
  manual: 'Manual',
  alias: 'Alias salvo',
  exact: 'Exato',
  case_insensitive: 'Maiúsc./minúsc.',
  accent_insensitive: 'Acentuação',
  normalized: 'Normalizado',
  fuzzy: 'Aproximado',
  none: 'Não vinculado',
};

/** Config for the shared confirmation modal (delete/cancel/reopen/remove file). */
interface ConfirmConfig {
  title: string;
  message: string;
  /** Strong warning banner (e.g. finance impact / sensitive data). */
  warning?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** When true, a reason input is shown and passed to onConfirm. */
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void> | void;
}

export default function FechamentoFolhaPage() {
  const { notify } = useHudToast();
  const [step, setStep] = useState(1);

  const [batch, setBatch] = useState<PayrollClosingBatch | null>(null);
  const [competence, setCompetence] = useState('');
  const [deadline, setDeadline] = useState('');
  const [parse, setParse] = useState<PayrollParseResult | null>(null);
  const [narrative, setNarrative] = useState<PayrollNarrative | null>(null);
  const [closingEmailText, setClosingEmailText] = useState('');
  const [attachments, setAttachments] = useState<PayrollAttachment[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [presetIdx, setPresetIdx] = useState(0);
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [recipients, setRecipients] = useState('');
  const [cc, setCc] = useState('');
  const [dispatches, setDispatches] = useState<PayrollEmailDispatch[]>([]);
  const [financeBatchId, setFinanceBatchId] = useState<string | null>(null);
  // The raw payroll spreadsheet File is kept in memory so we can parse it
  // client-side (SheetJS) regardless of repository mode (mock or supabase).
  const [payrollFile, setPayrollFile] = useState<File | null>(null);

  const [busy, setBusy] = useState<'parse' | 'ai' | 'test' | 'send' | 'finance' | null>(null);

  // ── Upload staging + lifecycle state ──────────────────────
  // Files chosen but not yet uploaded (removable with X before upload).
  const [staged, setStaged] = useState<Record<string, File[]>>({});
  const [notes, setNotes] = useState('');
  // Pending confirmation (delete/cancel/reopen/remove-file). A single modal renders it.
  const [confirmModal, setConfirmModal] = useState<ConfirmConfig | null>(null);
  const [reasonText, setReasonText] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  // ── Cost-center mapping state ─────────────────────────────
  // label → selected Finance cost_center_id ('' = unmapped). `ccMeta` keeps how
  // each link was resolved (for the status column).
  const [ccMappings, setCcMappings] = useState<Record<string, string>>({});
  const [ccMeta, setCcMeta] = useState<Record<string, { method: CostCenterMatchMethod; confidence: number }>>({});
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newCcName, setNewCcName] = useState('');
  const [confirmUnmapped, setConfirmUnmapped] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  // Saved aliases — from Supabase in supabase mode, localStorage in mock mode
  // (closing.listCostCenterMappings picks the source). Loaded on mount and after
  // each save so a reload / different browser still auto-matches the same names.
  const [savedMappings, setSavedMappings] = useState<PayrollCostCenterMapping[]>([]);
  // Finance cost centers backing the dropdown. In supabase mode these come from
  // finance_cost_centers (uuid ids) via the API; in mock mode from the client
  // store (cc-* ids). Either way only {id,code,name} is needed here.
  const [financeCostCenters, setFinanceCostCenters] = useState<CostCenterLike[]>([]);

  const ccOptions = useMemo(
    () => [{ value: '', label: '— Selecionar centro de custo —' }, ...financeCostCenters.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))],
    [financeCostCenters],
  );
  // Alias index translates any legacy cc-* values to the current finance uuids
  // (resolveFinanceCostCenterId), so saved aliases still resolve in supabase mode.
  const aliasIndex = useMemo(
    () => buildResolvedAliasIndex(savedMappings, financeCostCenters, getCostCenters()),
    [savedMappings, financeCostCenters],
  );

  const loadMappings = useCallback(async (): Promise<PayrollCostCenterMapping[]> => {
    const list = await closing.listCostCenterMappings();
    setSavedMappings(list);
    return list;
  }, []);

  const loadCostCenters = useCallback(async (): Promise<CostCenterLike[]> => {
    const list = await closing.listFinanceCostCenters();
    setFinanceCostCenters(list);
    return list;
  }, []);

  useEffect(() => { loadMappings(); loadCostCenters(); }, [loadMappings, loadCostCenters]);

  /**
   * Re-run the auto-match ladder over the parsed cost centers against the given
   * finance cost centers + alias index. Strong matches (alias/exact/case/accent/
   * normalized) are applied automatically; fuzzy hits are recorded in `ccMeta`
   * as suggestions but NOT auto-applied. Never touches amounts.
   */
  const runAutoMatch = useCallback((centers: PayrollCostCenterTotal[], finance: CostCenterLike[], index: Map<string, string>) => {
    const enriched = autoMatchCostCenters(centers, finance, index);
    const next: Record<string, string> = {};
    const meta: Record<string, { method: CostCenterMatchMethod; confidence: number }> = {};
    for (const cc of enriched) {
      meta[cc.cost_center_label] = { method: cc.match_method ?? 'none', confidence: cc.match_confidence ?? 0 };
      next[cc.cost_center_label] = cc.match_method && cc.match_method !== 'fuzzy' && cc.match_method !== 'none'
        ? (cc.cost_center_id ?? '') : '';
    }
    setCcMappings(next);
    setCcMeta(meta);
    setConfirmUnmapped(false);
  }, []);

  // ── Mapping derived state ─────────────────────────────────
  /** Parsed centers enriched with the current (selected) cost_center_id. */
  const mappedCenters = useMemo<PayrollCostCenterTotal[]>(
    () => (parse?.cost_centers ?? []).map((cc) => ({
      ...cc,
      cost_center_id: ccMappings[cc.cost_center_label] || undefined,
      match_method: ccMeta[cc.cost_center_label]?.method,
      match_confidence: ccMeta[cc.cost_center_label]?.confidence,
    })),
    [parse, ccMappings, ccMeta],
  );
  const unmappedCount = useMemo(() => mappedCenters.filter((c) => !c.cost_center_id).length, [mappedCenters]);
  const allMapped = (parse?.cost_centers.length ?? 0) > 0 && unmappedCount === 0;

  /** Finance handoff payload (imported_name → cost_center_id → amount …). */
  const financeHandoff = useMemo(
    () => (financeBatchId && parse ? buildFinanceHandoffLines(mappedCenters, parse.competence_month, financeBatchId) : []),
    [financeBatchId, parse, mappedCenters],
  );

  const refreshAttachments = useCallback(async (batchId: string) => {
    setAttachments(await closing.getAttachments(batchId));
  }, []);

  // ── Step 1: create batch + upload ─────────────────────────
  const ensureBatch = useCallback(async (): Promise<PayrollClosingBatch> => {
    if (batch) return batch;
    // findOrCreateBatch checks for an existing non-cancelled batch with the same
    // competence before creating, preventing the uq_pcb_org_comp_active violation.
    const found = await closing.findOrCreateBatch({ competence_month: competence, payment_deadline: deadline || undefined });
    setBatch(found);
    return found;
  }, [batch, competence, deadline]);

  // Stage files (selected, not yet uploaded) so they can be removed with X before upload.
  const stageFiles = useCallback((type: PayrollImportFileType, fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setStaged((prev) => ({ ...prev, [type]: [...(prev[type] ?? []), ...files] }));
    if (type === 'payroll_spreadsheet') setPayrollFile(files[0]);
  }, []);

  const unstageFile = useCallback((type: PayrollImportFileType, idx: number) => {
    setStaged((prev) => {
      const list = (prev[type] ?? []).filter((_, i) => i !== idx);
      if (type === 'payroll_spreadsheet' && list.length === 0) setPayrollFile(null);
      return { ...prev, [type]: list };
    });
  }, []);

  const uploadStaged = useCallback(async (type: PayrollImportFileType) => {
    const files = staged[type] ?? [];
    if (files.length === 0) return;
    try {
      const b = await ensureBatch();
      for (const file of files) await closing.uploadFile(b.id, file, type);
      await refreshAttachments(b.id);
      setStaged((prev) => ({ ...prev, [type]: [] }));
      notify(`${files.length} arquivo(s) enviado(s)`, { variant: 'success', description: UPLOAD_SLOTS.find((s) => s.type === type)?.label });
    } catch (err) {
      notify('Falha no upload', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    }
  }, [staged, ensureBatch, refreshAttachments, notify]);

  /** Uploaded attachments grouped by upload slot (excludes generated artifacts). */
  const uploadedBySlot = useMemo(() => {
    const map = new Map<PayrollImportFileType, PayrollAttachment[]>();
    for (const slot of UPLOAD_SLOTS) {
      map.set(slot.type, attachments.filter((a) => a.file_type === SLOT_ATTACHMENT_TYPE[slot.type] && !a.storage_path.includes('/generated/')));
    }
    return map;
  }, [attachments]);

  // ── Remove / replace an uploaded attachment ───────────────
  const performRemoveAttachment = useCallback(async (att: PayrollAttachment) => {
    if (!batch) return;
    const res = await closing.removeAttachment(batch.id, att.id);
    if (!res.ok) { notify('Falha ao remover anexo', { variant: 'error', description: res.error }); return; }
    setSelectedIds((prev) => prev.filter((id) => id !== att.id));
    // Removing the main spreadsheet invalidates parse, analysis and reports.
    if (res.was_payroll_spreadsheet) {
      const reset = await closing.invalidateParse(batch.id);
      setParse(null); setNarrative(null); setPayrollFile(null); setClosingEmailText('');
      if (reset) setBatch(reset);
      notify('Planilha removida — validação e análise foram invalidadas', { variant: 'warning', description: 'Reenvie e reprocesse a planilha geral.' });
    } else {
      notify('Anexo removido', { variant: 'success', description: att.file_name });
    }
    await refreshAttachments(batch.id);
  }, [batch, refreshAttachments, notify]);

  const requestRemoveAttachment = useCallback((att: PayrollAttachment) => {
    const sensitive = isSensitive(att.security_level);
    const isMain = att.file_type === 'payroll_spreadsheet';
    setConfirmModal({
      title: 'Remover anexo',
      message: `Remover "${att.file_name}"? O arquivo será excluído do Storage e dos pacotes de e-mail.`,
      warning: isMain
        ? 'É a planilha geral: a validação, a análise de IA e os relatórios gerados ficarão obsoletos e exigirão reprocessamento.'
        : sensitive ? 'Anexo sensível (holerite/bancário). Será removido dos próximos disparos de e-mail.' : undefined,
      confirmLabel: 'Remover', destructive: true,
      onConfirm: () => performRemoveAttachment(att),
    });
  }, [performRemoveAttachment]);

  // ── Batch lifecycle: edit / cancel / reopen / delete ──────
  /** Status-driven action rules — same source the server enforces. */
  const rules = useMemo(
    () => batchActionRules(batch?.status ?? 'imported', !!batch?.finance_batch_id),
    [batch?.status, batch?.finance_batch_id],
  );
  const financeWarn = batch ? financeImpactWarning(batch.status, !!batch.finance_batch_id) : null;

  const runConfirm = useCallback(async () => {
    if (!confirmModal) return;
    setLifecycleBusy(true);
    try {
      await confirmModal.onConfirm(reasonText.trim());
      setConfirmModal(null);
      setReasonText('');
    } catch (err) {
      notify('Ação falhou', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setLifecycleBusy(false);
    }
  }, [confirmModal, reasonText, notify]);

  const saveEdit = useCallback(async () => {
    if (!batch) return;
    setLifecycleBusy(true);
    try {
      const updated = await closing.updateBatch(batch.id, { competence_month: competence || undefined, payment_deadline: deadline || null, notes: notes || null });
      if (updated) setBatch(updated);
      setEditOpen(false);
      notify('Fechamento atualizado', { variant: 'success' });
    } catch (err) {
      notify('Falha ao editar', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setLifecycleBusy(false);
    }
  }, [batch, competence, deadline, notes, notify]);

  const requestCancel = useCallback(() => {
    if (!batch) return;
    setConfirmModal({
      title: 'Cancelar fechamento',
      message: 'O fechamento será marcado como cancelado (soft-delete). Pode ser reaberto depois.',
      warning: financeWarn ?? undefined,
      confirmLabel: 'Cancelar fechamento', destructive: true, requireReason: true,
      onConfirm: async (reason) => {
        const updated = await closing.cancelBatch(batch.id, reason);
        if (updated) setBatch(updated);
        notify('Fechamento cancelado', { variant: 'success' });
      },
    });
  }, [batch, financeWarn, notify]);

  const requestReopen = useCallback(() => {
    if (!batch) return;
    setConfirmModal({
      title: 'Reabrir fechamento',
      message: 'O fechamento volta para um status editável. A ação é registrada em auditoria.',
      warning: financeWarn ?? undefined,
      confirmLabel: 'Reabrir', requireReason: true,
      onConfirm: async (reason) => {
        const updated = await closing.reopenBatch(batch.id, reason);
        if (updated) setBatch(updated);
        notify('Fechamento reaberto', { variant: 'success' });
      },
    });
  }, [batch, financeWarn, notify]);

  const requestDelete = useCallback(() => {
    if (!batch) return;
    setConfirmModal({
      title: 'Excluir fechamento',
      message: 'Exclusão permanente: remove lotes, anexos, relatórios e arquivos do Storage. Esta ação não pode ser desfeita.',
      warning: financeWarn ?? undefined,
      confirmLabel: 'Excluir definitivamente', destructive: true, requireReason: true,
      onConfirm: async () => {
        const res = await closing.deleteBatch(batch.id);
        if (!res.ok) { notify('Não foi possível excluir', { variant: 'error', description: res.error }); return; }
        // Reset the page back to a fresh workflow.
        setBatch(null); setParse(null); setNarrative(null); setAttachments([]); setPayrollFile(null);
        setFinanceBatchId(null); setStep(1);
        notify('Fechamento excluído', { variant: 'success' });
      },
    });
  }, [batch, financeWarn, notify]);

  const reparseAfterInvalidate = useCallback(async () => {
    if (!batch) return;
    setLifecycleBusy(true);
    try {
      const reset = await closing.invalidateParse(batch.id);
      if (reset) setBatch(reset);
      setParse(null); setNarrative(null); setClosingEmailText('');
      notify('Análise invalidada — reprocesse a planilha', { variant: 'info', description: 'Vá para a Validação e leia a planilha novamente.' });
      setStep(2);
    } catch (err) {
      notify('Falha ao reprocessar', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setLifecycleBusy(false);
    }
  }, [batch, notify]);

  // ── Step 2: parse ─────────────────────────────────────────
  const onParse = useCallback(async () => {
    if (!batch) return;
    if (!payrollFile) {
      notify('Anexe a planilha geral da folha antes de validar.', { variant: 'warning' });
      return;
    }
    setBusy('parse');
    try {
      const result = await parsePayrollWorkbook(payrollFile, { competenceHint: competence });
      const updated = await closing.saveParse(batch.id, result);
      setParse(result);
      // Apply saved aliases + finance cost centers (Supabase/localStorage) BEFORE
      // the warnings render, so known names arrive pre-matched.
      const [list, finance] = await Promise.all([loadMappings(), loadCostCenters()]);
      runAutoMatch(result.cost_centers, finance, buildResolvedAliasIndex(list, finance, getCostCenters()));
      if (updated) setBatch(updated);
      if (result.competence_month) setCompetence(result.competence_month);
      const errors = result.flags.filter((f) => f.severity === 'error').length;
      notify(errors > 0 ? 'Planilha lida com pendências' : 'Planilha validada', {
        variant: errors > 0 ? 'warning' : 'success',
        description: `${result.detected_sheets.length} aba(s), ${result.cost_centers.length} centro(s) de custo`,
      });
    } catch (err) {
      notify('Falha ao ler a planilha', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [batch, payrollFile, competence, notify, runAutoMatch, loadMappings, loadCostCenters]);

  // ── Step 3: AI narrative + generated artifacts ────────────
  const onGenerateAi = useCallback(async () => {
    if (!batch || !parse) return;
    setBusy('ai');
    try {
      const res = await requestNarrative(parse);
      if (!res.ok || !res.narrative) {
        notify('Falha na análise', { variant: 'error', description: res.error });
        return;
      }
      const nar = res.narrative;
      setNarrative(nar);
      setClosingEmailText(nar.closing_email);

      // Persist reports
      const html = buildEmailHtml({ parse, narrative: nar, audience: 'custom' });
      await closing.saveReport(batch.id, { report_type: 'executive_email', generated_text: buildEmailText({ parse, narrative: nar, audience: 'custom' }), generated_html: html, generated_by_ai: nar.generated_by_ai });
      await closing.saveReport(batch.id, { report_type: 'board_summary', generated_text: nar.board_summary, generated_html: '', generated_by_ai: nar.generated_by_ai });

      // Generate executive PDF (print-ready HTML) + dashboard snapshot as attachments
      const reportHtml = buildExecutiveReportHtml(parse, nar);
      await closing.addGeneratedAttachment(batch.id, {
        file_name: `relatorio-executivo-folha-${parse.competence_month}.html`,
        file_type: 'executive_pdf', mime_type: 'text/html', security_level: 'aggregate', html: reportHtml,
      });
      await closing.addGeneratedAttachment(batch.id, {
        file_name: `dashboard-folha-${parse.competence_month}.html`,
        file_type: 'dashboard_snapshot', mime_type: 'text/html', security_level: 'aggregate', html,
      });
      await refreshAttachments(batch.id);

      notify(nar.generated_by_ai ? 'Análise gerada pela IA' : 'Rascunho automático gerado (sem IA)', {
        variant: nar.generated_by_ai ? 'success' : 'info',
      });
    } catch (err) {
      notify('Erro ao gerar análise', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [batch, parse, refreshAttachments, notify]);

  // ── Step 4: package selection ─────────────────────────────
  const applyPreset = useCallback(
    (idx: number) => {
      setPresetIdx(idx);
      setConfirmSensitive(false);
      const preset = PACKAGE_PRESETS[idx];
      if (preset.audience === 'custom') {
        setSelectedIds([]);
        return;
      }
      const ids = attachments
        .filter((a) => preset.default_file_types.includes(a.file_type))
        .map((a) => a.id);
      setSelectedIds(ids);
    },
    [attachments],
  );

  const toggleAttachment = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setConfirmSensitive(false);
  }, []);

  const selectedAttachments = useMemo(
    () => attachments.filter((a) => selectedIds.includes(a.id)),
    [attachments, selectedIds],
  );
  const totalSize = useMemo(() => selectedAttachments.reduce((s, a) => s + a.file_size, 0), [selectedAttachments]);
  const hasSensitive = useMemo(() => selectedAttachments.some((a) => isSensitive(a.security_level)), [selectedAttachments]);
  const overLimit = totalSize > 40 * 1024 * 1024;

  // ── Step 5: send ──────────────────────────────────────────
  const doSend = useCallback(
    async (test: boolean) => {
      if (!batch || !parse) return;
      const recipientList = recipients.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      if (recipientList.length === 0) {
        notify('Informe ao menos um destinatário.', { variant: 'warning' });
        return;
      }
      if (!test && hasSensitive && !confirmSensitive) {
        notify('Confirme o envio de anexos sensíveis no passo de Anexos.', { variant: 'warning' });
        return;
      }
      setBusy(test ? 'test' : 'send');
      try {
        const audience = PACKAGE_PRESETS[presetIdx].audience;
        const html = buildEmailHtml({ parse, narrative, audience });
        const ccList = cc.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
        const res = await closing.sendEmail({
          batchId: batch.id, subject: `Fechamento da Folha — ${parse.competence_month}`,
          html, recipients: recipientList, cc: ccList, audience,
          attachmentIds: selectedIds, confirmSensitive: confirmSensitive || !hasSensitive, test,
        });
        if (!res.ok) {
          notify('Envio falhou', { variant: 'error', description: res.message || res.error });
          return;
        }
        setDispatches(await closing.getDispatches(batch.id));
        const simulated = res.delivery_status === 'simulated';
        notify(
          test ? 'E-mail de teste processado' : simulated ? 'Envio simulado registrado' : 'E-mail enviado',
          {
            variant: simulated ? 'info' : 'success',
            description: simulated
              ? `${(res.attachments_sent ?? []).length} anexo(s) — ${res.reason ?? 'modo simulado'}`
              : `Provider: ${res.provider_message_id ?? '—'}`,
          },
        );
      } catch (err) {
        notify('Erro no envio', { variant: 'error', description: err instanceof Error ? err.message : undefined });
      } finally {
        setBusy(null);
      }
    },
    [batch, parse, narrative, recipients, cc, hasSensitive, confirmSensitive, presetIdx, selectedIds, notify],
  );

  // ── Step 6: finance ───────────────────────────────────────
  const onSendToFinance = useCallback(async () => {
    if (!batch) return;
    setBusy('finance');
    try {
      // Persist the resolved cost_center_id on each parsed center so the finance
      // batch carries the mapping (imported_name → cost_center_id). Amounts are
      // copied straight from the parser — totals are never altered here.
      if (parse) {
        const enriched: PayrollParseResult = { ...parse, cost_centers: mappedCenters };
        await closing.saveParse(batch.id, enriched);
        setParse(enriched);
      }
      let current = batch;
      if (current.status !== 'approved' && current.status !== 'sent_to_finance') {
        const approved = await closing.approveBatch(current.id);
        if (approved) {
          current = approved;
          setBatch(approved);
        }
      }
      // When centers are unmapped the server blocks unless an authorized
      // override (admin / people.payroll_override_mapping) is supplied with a
      // reason. The reason is recorded in the audit log server-side.
      const override = unmappedCount > 0 && confirmUnmapped;
      const result = await closing.sendToFinance(current.id, override ? { override: true, overrideReason: overrideReason.trim() } : undefined);
      if (!result.ok) {
        const desc = result.code === 'unmapped_cost_centers'
          ? `${result.unmapped_count ?? unmappedCount} centro(s) sem vínculo. Vincule ou autorize o override.`
          : result.error;
        notify('Não foi possível enviar ao Financeiro', { variant: 'error', description: desc });
        if (result.finance_batch_id) setFinanceBatchId(result.finance_batch_id);
        return;
      }
      if (result.batch) setBatch(result.batch);
      setFinanceBatchId(result.finance_batch_id ?? null);
      notify('Lote enviado ao Financeiro', { variant: 'success', description: `PayrollBatch ${result.finance_batch_id}` });
    } catch (err) {
      notify('Erro ao enviar ao Financeiro', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [batch, parse, mappedCenters, unmappedCount, confirmUnmapped, overrideReason, notify]);

  // ── KPIs ──────────────────────────────────────────────────
  const kpis: KpiItem[] = useMemo(() => {
    if (!parse) return [];
    return [
      { id: 'total', label: 'Total da Folha', value: formatBRL(parse.total_amount_cents) },
      { id: 'prev', label: 'Mês Anterior', value: formatBRL(parse.previous_month_amount_cents) },
      {
        id: 'var', label: 'Variação',
        value: `${formatBRL(parse.variation_amount_cents)}`,
        deltaText: `${parse.variation_percentage.toFixed(2)}%`,
        deltaTone: parse.variation_amount_cents >= 0 ? 'danger' : 'success',
      },
      { id: 'hc', label: 'Headcount', value: parse.headcount ?? '—' },
    ];
  }, [parse]);

  /** Best (incl. fuzzy) match per label, for the "Aplicar sugestões" action. */
  const suggestions = useMemo(() => {
    const out: Record<string, string> = {};
    for (const cc of parse?.cost_centers ?? []) {
      const m = matchCostCenter(cc.cost_center_label, financeCostCenters, aliasIndex);
      if (m.cost_center_id) out[cc.cost_center_label] = m.cost_center_id;
    }
    return out;
  }, [parse, financeCostCenters, aliasIndex]);

  const setMapping = useCallback((label: string, costCenterId: string) => {
    setCcMappings((prev) => ({ ...prev, [label]: costCenterId }));
    setCcMeta((prev) => ({ ...prev, [label]: { method: costCenterId ? 'manual' : 'none', confidence: costCenterId ? 1 : 0 } }));
    setConfirmUnmapped(false);
  }, []);

  /** Fill every still-unmapped center with its best suggestion (incl. fuzzy). */
  const handleApplySuggestions = useCallback(() => {
    const toApply = Object.entries(suggestions).filter(([label]) => !ccMappings[label]);
    if (toApply.length === 0) { notify('Nenhuma sugestão pendente', { variant: 'info' }); return; }
    setCcMappings((prev) => {
      const next = { ...prev };
      for (const [label, id] of toApply) next[label] = id;
      return next;
    });
    setCcMeta((prev) => {
      const next = { ...prev };
      for (const [label] of toApply) {
        const existing = next[label];
        next[label] = { method: existing?.method && existing.method !== 'none' ? existing.method : 'fuzzy', confidence: existing?.confidence ?? 0 };
      }
      return next;
    });
    notify(`${toApply.length} sugestão(ões) aplicada(s)`, { variant: 'success' });
  }, [suggestions, ccMappings, notify]);

  /** Persist current selections as reusable aliases (future imports auto-match). */
  const handleSaveMappings = useCallback(async () => {
    const inputs = mappedCenters
      .filter((c) => c.cost_center_id)
      .map((c) => ({
        imported_name: c.cost_center_label, cost_center_id: c.cost_center_id as string,
        confidence: 1, match_method: ccMeta[c.cost_center_label]?.method,
      }));
    if (inputs.length === 0) { notify('Nenhum mapeamento para salvar.', { variant: 'warning' }); return; }
    try {
      await closing.saveCostCenterMappings(inputs);
      await loadMappings();
      notify(`${inputs.length} mapeamento(s) salvo(s)`, { variant: 'success', description: 'Compartilhado entre usuários — próximas importações vincularão automaticamente.' });
    } catch (err) {
      notify('Falha ao salvar mapeamentos', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    }
  }, [mappedCenters, ccMeta, notify, loadMappings]);

  /** Re-read aliases + Finance master data and re-run the auto-match ladder. */
  const handleRevalidate = useCallback(async () => {
    if (!parse) return;
    const [list, finance] = await Promise.all([loadMappings(), loadCostCenters()]);
    runAutoMatch(parse.cost_centers, finance, buildResolvedAliasIndex(list, finance, getCostCenters()));
    notify('Planilha revalidada', { variant: 'info', description: 'Mapeamentos recalculados a partir dos aliases e do Financeiro.' });
  }, [parse, runAutoMatch, notify, loadMappings, loadCostCenters]);

  /** Create a Finance cost center for an imported name and link it immediately. */
  const handleCreateCostCenter = useCallback(async (label: string) => {
    const name = (newCcName || label).trim();
    if (!name) return;
    try {
      const cc = await closing.createFinanceCostCenter(name);
      await loadCostCenters();
      setMapping(label, cc.id);
      setCreatingFor(null);
      setNewCcName('');
      notify(`Centro de custo "${cc.name}" criado`, { variant: 'success', description: `Vinculado a "${label}".` });
    } catch (err) {
      notify('Falha ao criar centro de custo', { variant: 'error', description: err instanceof Error ? err.message : undefined });
    }
  }, [newCcName, setMapping, notify, loadCostCenters]);

  return (
    <HudPageLayout>
      <HudHeader
        title="Fechamento da Folha"
        subtitle="Pessoas & Custos — Importação, análise, aprovação e envio automatizado"
        icon={<FileSpreadsheet className="w-5 h-5" />}
        breadcrumbs={[{ label: 'Pessoas & Custos', href: '/workforce-cost' }, { label: 'Fechamento da Folha' }]}
        statusChips={batch ? [{ label: batch.status, variant: 'info' }] : undefined}
      />

      {/* Stepper */}
      <div className="flex flex-wrap gap-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = step === s.n;
          const done = step > s.n;
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(s.n)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${
                active ? 'border-ig-accent bg-ig-accent-weak/40 text-ig-fg-strong'
                : done ? 'border-ig-border-focus/50 text-ig-fg-strong'
                : 'border-ig-border-subtle text-ig-fg-subtle'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="font-medium">{s.n}. {s.label}</span>
              {done && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
            </button>
          );
        })}
      </div>

      {/* Batch lifecycle actions — visible once a closing exists */}
      {batch && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ig-border-subtle px-3 py-2">
          <span className="text-xs text-ig-fg-subtle mr-1">Ações do fechamento:</span>
          <HudStatusPill variant={STATUS_VARIANT[batch.status]} size="sm">{batch.status}</HudStatusPill>
          <ActionButton icon={<Pencil className="w-3.5 h-3.5" />} label="Editar" rule={rules.edit} onClick={() => { setNotes(''); setEditOpen(true); }} />
          <ActionButton icon={<RefreshCw className="w-3.5 h-3.5" />} label="Reprocessar planilha" rule={rules.reparse} onClick={reparseAfterInvalidate} />
          <ActionButton icon={<RotateCcw className="w-3.5 h-3.5" />} label="Reabrir" rule={rules.reopen} onClick={requestReopen} />
          <ActionButton icon={<AlertTriangle className="w-3.5 h-3.5" />} label="Cancelar" rule={rules.cancel} onClick={requestCancel} />
          <ActionButton icon={<Trash2 className="w-3.5 h-3.5" />} label="Excluir" rule={rules.delete} destructive onClick={requestDelete} />
          {batch.status === 'posted' && (
            <span className="text-[11px] text-amber-300 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Lançado no ledger — exige estorno/ajuste.</span>
          )}
        </div>
      )}

      {parse && <HudKpiStrip kpis={kpis} columns={4} />}

      {/* STEP 1 — Upload */}
      {step === 1 && (
        <HudPanel title="1. Upload de Arquivos" subtitle="A planilha de folha é a fonte da verdade dos números" icon={<Upload className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ig-fg-subtle">Competência (YYYY-MM)</span>
              <input value={competence} onChange={(e) => setCompetence(e.target.value)} placeholder="2026-05"
                className="rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ig-fg-subtle">Prazo de Pagamento</span>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className="rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2" />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {UPLOAD_SLOTS.map((slot) => {
              const stagedFiles = staged[slot.type] ?? [];
              const uploaded = uploadedBySlot.get(slot.type) ?? [];
              return (
                <div key={slot.type} className="rounded-xl border border-ig-border-subtle p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{slot.label}{slot.required && <span className="text-rose-400"> *</span>}</span>
                    <div className="flex items-center gap-1.5">
                      {slot.sensitive && <HudBadge variant="warning">sensível</HudBadge>}
                      {uploaded.length > 0 && <HudBadge variant="success">{uploaded.length} enviado(s)</HudBadge>}
                    </div>
                  </div>
                  {slot.hint && <p className="text-[11px] text-ig-fg-subtle mb-2">{slot.hint}</p>}
                  <p className="text-[10px] text-ig-fg-subtle mb-2">Aceita: {slot.accept}</p>

                  {/* Uploaded files — X removes (with confirm), Trocar replaces */}
                  {uploaded.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 rounded-lg border border-emerald-500/30 px-2 py-1.5 mb-1.5 text-xs">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="flex-1 truncate" title={a.file_name}>{a.file_name}</span>
                      <span className="text-ig-fg-subtle tabular-nums">{formatBytes(a.file_size)}</span>
                      <HudBadge variant="neutral">enviado</HudBadge>
                      <button type="button" title="Trocar arquivo" className="text-ig-fg-subtle hover:text-ig-fg-strong" onClick={() => requestRemoveAttachment(a)}>
                        <Replace className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" title="Remover" className="text-rose-400 hover:text-rose-300" onClick={() => requestRemoveAttachment(a)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  {/* Staged files — X removes from selection (before upload) */}
                  {stagedFiles.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-ig-border-subtle px-2 py-1.5 mb-1.5 text-xs">
                      <Paperclip className="w-3.5 h-3.5 text-ig-fg-subtle shrink-0" />
                      <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                      <span className="text-ig-fg-subtle tabular-nums">{formatBytes(f.size)}</span>
                      <HudBadge variant="info">selecionado</HudBadge>
                      <button type="button" title="Remover da seleção" className="text-rose-400 hover:text-rose-300" onClick={() => unstageFile(slot.type, i)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}

                  <input type="file" multiple accept={slot.accept}
                    onChange={(e) => { stageFiles(slot.type, e.target.files); e.target.value = ''; }}
                    className="block w-full text-xs text-ig-fg-subtle file:mr-3 file:rounded-lg file:border-0 file:bg-ig-accent-weak file:px-3 file:py-1.5 file:text-ig-fg-strong" />

                  {stagedFiles.length > 0 && (
                    <div className="mt-2 flex justify-end">
                      <HudButton variant="secondary" size="sm" leftIcon={<Upload className="w-3.5 h-3.5" />} onClick={() => uploadStaged(slot.type)}>
                        Enviar {stagedFiles.length} arquivo(s)
                      </HudButton>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="text-xs text-ig-fg-subtle">
              {Object.values(staged).some((l) => l.length > 0) ? 'Há arquivos selecionados não enviados — clique em “Enviar”.' : ''}
            </span>
            <HudButton variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />}
              disabled={!attachments.some((a) => a.file_type === 'payroll_spreadsheet')}
              onClick={() => setStep(2)}>
              Avançar para Validação
            </HudButton>
          </div>
        </HudPanel>
      )}

      {/* STEP 2 — Parse & Validate */}
      {step === 2 && (
        <HudPanel title="2. Validação da Planilha" subtitle="Leitura determinística (SheetJS) e conferência de totais" icon={<ScanLine className="w-4 h-4" />}>
          <div className="flex justify-end mb-4">
            <HudButton variant="primary" isLoading={busy === 'parse'} leftIcon={<ScanLine className="w-4 h-4" />} onClick={onParse}>
              Ler e validar planilha
            </HudButton>
          </div>
          {parse ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="text-ig-fg-subtle">Abas detectadas:</span>
                {parse.detected_sheets.map((s) => <HudBadge key={s} variant="info">{s}</HudBadge>)}
                <HudStatusPill variant={parse.reconciled ? 'completed' : 'pending'}>
                  {parse.reconciled ? 'Reconciliado' : 'Divergência'}
                </HudStatusPill>
              </div>

              {parse.flags.length > 0 && (
                <div className="space-y-2">
                  {parse.flags.map((f, i) => (
                    <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                      f.severity === 'error' ? 'border-rose-500/40 text-rose-300'
                      : f.severity === 'warning' ? 'border-amber-500/40 text-amber-300'
                      : 'border-ig-border-subtle text-ig-fg-subtle'}`}>
                      {f.severity === 'error' ? <ShieldAlert className="w-4 h-4 mt-0.5" /> : f.severity === 'warning' ? <AlertTriangle className="w-4 h-4 mt-0.5" /> : <Info className="w-4 h-4 mt-0.5" />}
                      <span>{f.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Cost-center mapping ─ link imported names to Finance master data */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2"><Link2 className="w-4 h-4" /> Mapeamento de Centros de Custo</h4>
                  {parse.cost_centers.length > 0 && (
                    allMapped ? (
                      <HudStatusPill variant="completed">Todos vinculados</HudStatusPill>
                    ) : (
                      <HudStatusPill variant="pending">{unmappedCount} não vinculado(s)</HudStatusPill>
                    )
                  )}
                </div>

                {parse.cost_centers.length === 0 ? (
                  <p className="text-sm text-ig-fg-subtle">Nenhum centro de custo detectado na planilha.</p>
                ) : (
                  <>
                    {/* Action toolbar */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      <HudButton variant="secondary" size="sm" leftIcon={<Save className="w-3.5 h-3.5" />} onClick={handleSaveMappings}>Salvar mapeamentos</HudButton>
                      <HudButton variant="secondary" size="sm" leftIcon={<Wand2 className="w-3.5 h-3.5" />} onClick={handleApplySuggestions}>Aplicar sugestões</HudButton>
                      <HudButton variant="secondary" size="sm" leftIcon={<RefreshCw className="w-3.5 h-3.5" />} onClick={handleRevalidate}>Revalidar planilha</HudButton>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-ig-border-subtle">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-ig-fg-subtle border-b border-ig-border-subtle">
                            <th className="px-3 py-2 font-medium">Centro (importado)</th>
                            <th className="px-3 py-2 font-medium text-right">Valor</th>
                            <th className="px-3 py-2 font-medium text-right">Mês anterior</th>
                            <th className="px-3 py-2 font-medium text-right">Variação</th>
                            <th className="px-3 py-2 font-medium">Status</th>
                            <th className="px-3 py-2 font-medium min-w-[16rem]">Centro de Custo (Financeiro)</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {mappedCenters.map((c) => {
                            const meta = ccMeta[c.cost_center_label] ?? { method: 'none' as CostCenterMatchMethod, confidence: 0 };
                            const mapped = !!c.cost_center_id;
                            const variant: HudStatusPillVariant = mapped
                              ? (meta.method === 'fuzzy' ? 'pending' : 'completed')
                              : (suggestions[c.cost_center_label] ? 'info' : 'error');
                            const statusLabel = mapped
                              ? `${MATCH_LABEL[meta.method]}${meta.method === 'fuzzy' ? ` ${(meta.confidence * 100).toFixed(0)}%` : ''}`
                              : (suggestions[c.cost_center_label] ? 'Sugestão disponível' : 'Não vinculado');
                            const isCreating = creatingFor === c.cost_center_label;
                            return (
                              <tr key={c.cost_center_label} className="border-b border-ig-border-subtle/50 last:border-0">
                                <td className="px-3 py-2 max-w-[14rem] truncate" title={c.cost_center_label}>{c.cost_center_label}</td>
                                <td className="px-3 py-2 text-right tabular-nums">{formatBRL(c.amount_cents)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-ig-fg-subtle">{c.previous_amount_cents != null ? formatBRL(c.previous_amount_cents) : '—'}</td>
                                <td className={`px-3 py-2 text-right tabular-nums ${c.variation_amount_cents != null ? (c.variation_amount_cents >= 0 ? 'text-rose-300' : 'text-emerald-300') : 'text-ig-fg-subtle'}`}>
                                  {c.variation_amount_cents != null ? `${c.variation_amount_cents >= 0 ? '+' : ''}${formatBRL(c.variation_amount_cents)}` : '—'}
                                  {c.variation_percentage != null && <span className="block text-[10px] opacity-70">{c.variation_percentage >= 0 ? '+' : ''}{c.variation_percentage.toFixed(1)}%</span>}
                                </td>
                                <td className="px-3 py-2"><HudStatusPill variant={variant} size="sm">{statusLabel}</HudStatusPill></td>
                                <td className="px-3 py-2">
                                  {isCreating ? (
                                    <div className="flex items-center gap-2">
                                      <HudInput value={newCcName} placeholder={c.cost_center_label} size="sm" onChange={(e) => setNewCcName(e.target.value)} />
                                      <HudButton variant="primary" size="sm" onClick={() => handleCreateCostCenter(c.cost_center_label)}>Criar</HudButton>
                                      <button type="button" className="text-ig-fg-subtle hover:text-ig-fg-strong" onClick={() => { setCreatingFor(null); setNewCcName(''); }}><X className="w-4 h-4" /></button>
                                    </div>
                                  ) : (
                                    <HudSelect value={c.cost_center_id ?? ''} options={ccOptions} size="sm" onChange={(v) => setMapping(c.cost_center_label, v)} />
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {!isCreating && (
                                    <HudButton variant="ghost" size="sm" leftIcon={<Plus className="w-3.5 h-3.5" />}
                                      onClick={() => { setCreatingFor(c.cost_center_label); setNewCcName(c.cost_center_label); }}>
                                      Criar
                                    </HudButton>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {allMapped ? (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300">
                        <CheckCircle className="w-4 h-4" /> Todos os centros de custo estão vinculados ao Financeiro. Validação OK.
                      </div>
                    ) : (
                      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-300">
                        <AlertTriangle className="w-4 h-4" /> {unmappedCount} centro(s) de custo sem vínculo. Vincule, aplique sugestões ou crie o centro no Financeiro antes do envio.
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex justify-end">
                <HudButton variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />}
                  disabled={parse.flags.some((f) => f.severity === 'error')}
                  onClick={() => setStep(3)}>
                  Avançar para Análise IA
                </HudButton>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ig-fg-subtle">Clique em “Ler e validar planilha” para extrair os totais.</p>
          )}
        </HudPanel>
      )}

      {/* STEP 3 — AI */}
      {step === 3 && (
        <HudPanel title="3. Análise por IA" subtitle="A IA gera apenas narrativa — nunca inventa valores" icon={<Sparkles className="w-4 h-4" />}>
          <div className="flex justify-end mb-4">
            <HudButton variant="primary" isLoading={busy === 'ai'} leftIcon={<Sparkles className="w-4 h-4" />} disabled={!parse} onClick={onGenerateAi}>
              Gerar análise e relatórios
            </HudButton>
          </div>
          {narrative ? (
            <div className="space-y-5">
              {!narrative.generated_by_ai && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-300">
                  <Info className="w-4 h-4 mt-0.5" /> Rascunho automático (sem IA — ANTHROPIC_API_KEY ausente). Revise antes de enviar.
                </div>
              )}
              <div>
                <h4 className="text-sm font-semibold mb-1">Resumo Executivo</h4>
                <p className="text-sm text-ig-fg-subtle whitespace-pre-wrap">{narrative.executive_summary}</p>
              </div>
              <label className="block">
                <span className="text-sm font-semibold">E-mail de Fechamento (editável)</span>
                <textarea value={closingEmailText} onChange={(e) => setClosingEmailText(e.target.value)} rows={6}
                  className="mt-1 w-full rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2 text-sm" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ListBlock title="Pontos de Atenção" items={narrative.attention_points} tone="warning" />
                <ListBlock title="Recomendações" items={narrative.recommendations} />
                <ListBlock title="Maiores Aumentos" items={narrative.top_increases} />
                <ListBlock title="Maiores Quedas" items={narrative.top_decreases} />
              </div>
              <div className="flex justify-end">
                <HudButton variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />} onClick={() => { applyPreset(0); setStep(4); }}>
                  Avançar para Anexos
                </HudButton>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ig-fg-subtle">Gere a análise para revisar o e-mail e os pontos de atenção.</p>
          )}
        </HudPanel>
      )}

      {/* STEP 4 — Attachments */}
      {step === 4 && (
        <HudPanel title="4. Anexos e Pacotes" subtitle="Anexos diretos (sem links). Confirme arquivos sensíveis." icon={<Paperclip className="w-4 h-4" />}>
          <div className="flex flex-wrap gap-2 mb-4">
            {PACKAGE_PRESETS.map((p, i) => (
              <button key={p.label} type="button" onClick={() => applyPreset(i)}
                className={`rounded-lg border px-3 py-2 text-sm ${presetIdx === i ? 'border-ig-accent bg-ig-accent-weak/40' : 'border-ig-border-subtle text-ig-fg-subtle'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ig-fg-subtle mb-3">{PACKAGE_PRESETS[presetIdx].description}</p>

          <div className="space-y-2">
            {attachments.length === 0 && <p className="text-sm text-ig-fg-subtle">Nenhum anexo disponível. Volte ao upload ou gere os relatórios.</p>}
            {attachments.map((a) => {
              const checked = selectedIds.includes(a.id);
              const sensitive = isSensitive(a.security_level);
              return (
                <label key={a.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 cursor-pointer ${checked ? 'border-ig-accent/60' : 'border-ig-border-subtle'}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleAttachment(a.id)} />
                  <span className="flex-1 text-sm truncate">{a.file_name}</span>
                  <HudBadge variant="info">{ATTACHMENT_TYPE_LABEL[a.file_type]}</HudBadge>
                  <HudBadge variant={sensitive ? 'warning' : 'neutral'}>{SECURITY_LABEL[a.security_level]}</HudBadge>
                  <span className="w-20 text-right text-xs text-ig-fg-subtle tabular-nums">{formatBytes(a.file_size)}</span>
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-ig-fg-subtle">{selectedAttachments.length} anexo(s) · <strong className={overLimit ? 'text-rose-400' : ''}>{formatBytes(totalSize)}</strong> / 40 MB</span>
            {overLimit && <span className="text-rose-400 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Acima do limite — divida, compacte (ZIP) ou remova anexos.</span>}
          </div>

          {hasSensitive && (
            <label className="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-200">
              <input type="checkbox" checked={confirmSensitive} onChange={(e) => setConfirmSensitive(e.target.checked)} />
              <ShieldAlert className="w-4 h-4" /> Confirmo o envio de anexos sensíveis aos destinatários selecionados.
            </label>
          )}

          <div className="mt-5 flex justify-end">
            <HudButton variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />}
              disabled={selectedIds.length === 0 || overLimit || (hasSensitive && !confirmSensitive)}
              onClick={() => setStep(5)}>
              Avançar para Envio
            </HudButton>
          </div>
        </HudPanel>
      )}

      {/* STEP 5 — Email */}
      {step === 5 && (
        <HudPanel title="5. Envio por E-mail" subtitle="Anexos diretos. Sem RESEND_API_KEY o envio é simulado." icon={<Send className="w-4 h-4" />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ig-fg-subtle">Destinatários (separados por vírgula)</span>
              <input value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="diretoria@empresa.com, financeiro@empresa.com"
                className="rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ig-fg-subtle">CC</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)}
                className="rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2" />
            </label>
          </div>

          <div className="rounded-xl border border-ig-border-subtle p-3 mb-4 text-xs text-ig-fg-subtle">
            <div className="mb-1">Assunto: <strong className="text-ig-fg-strong">Fechamento da Folha — {parse?.competence_month}</strong></div>
            <div>Anexos: {selectedAttachments.map((a) => a.file_name).join(', ') || '—'}</div>
          </div>

          <div className="flex gap-2 justify-end">
            <HudButton variant="secondary" isLoading={busy === 'test'} onClick={() => doSend(true)}>Enviar teste</HudButton>
            <HudButton variant="primary" isLoading={busy === 'send'} leftIcon={<Send className="w-4 h-4" />} onClick={() => doSend(false)}>Enviar e-mail final</HudButton>
          </div>

          {dispatches.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-semibold mb-2">Histórico de Disparos</h4>
              <div className="space-y-2">
                {dispatches.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 rounded-lg border border-ig-border-subtle px-3 py-2 text-sm">
                    <HudStatusPill variant={d.delivery_status === 'sent' ? 'completed' : d.delivery_status === 'failed' ? 'error' : 'info'}>
                      {d.delivery_status}
                    </HudStatusPill>
                    <span className="flex-1 truncate">{d.recipients.join(', ')}</span>
                    <span className="text-xs text-ig-fg-subtle">{d.attachments_sent.length} anexo(s)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <HudButton variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />} onClick={() => setStep(6)}>Avançar para Financeiro</HudButton>
          </div>
        </HudPanel>
      )}

      {/* STEP 6 — Finance */}
      {step === 6 && (
        <HudPanel title="6. Enviar ao Financeiro" subtitle="Cria o lote consumido por Financeiro > Folha & Alocação" icon={<Banknote className="w-4 h-4" />}>
          {batch && (
            <div className="flex items-center gap-3 mb-4 text-sm">
              <span>Status do fechamento:</span>
              <HudStatusPill variant={STATUS_VARIANT[batch.status]}>{batch.status}</HudStatusPill>
            </div>
          )}
          <p className="text-sm text-ig-fg-subtle mb-4">
            Ao enviar, o fechamento aprovado cria um <strong>PayrollBatch</strong> (sem postar no ledger).
            O Financeiro fará a alocação e a postagem em Folha & Alocação. Cada fechamento gera no máximo um lote (anti-duplicidade).
          </p>

          {/* Required-mapping gate — block strongly when cost centers are unmapped */}
          {!financeBatchId && parse && unmappedCount > 0 && (
            <div className="mb-4 rounded-xl border border-amber-500/50 p-4">
              <div className="flex items-start gap-2 text-amber-300 mb-2">
                <ShieldAlert className="w-5 h-5 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">{unmappedCount} centro(s) de custo sem vínculo com o Financeiro.</p>
                  <p className="text-xs text-ig-fg-subtle mt-0.5">Volte à Validação para vincular — ou confirme o envio mesmo assim (o Financeiro fará a alocação manual dos não vinculados).</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <HudButton variant="secondary" size="sm" onClick={() => setStep(2)}>Voltar ao mapeamento</HudButton>
                <label className="flex items-center gap-2 text-sm text-amber-200">
                  <input type="checkbox" checked={confirmUnmapped} onChange={(e) => setConfirmUnmapped(e.target.checked)} />
                  Enviar mesmo com centros não vinculados (override)
                </label>
              </div>
              {confirmUnmapped && (
                <div className="mt-3">
                  <HudInput label="Motivo do override (registrado em auditoria)" value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)} placeholder="Ex.: centro novo, alocação manual combinada com o Financeiro" />
                  <p className="mt-1 text-[11px] text-ig-fg-subtle">Requer perfil owner/admin ou a permissão <code>people.payroll_override_mapping</code>. O servidor bloqueia o envio sem autorização.</p>
                </div>
              )}
            </div>
          )}

          {/* Finance handoff preview — exactly what each line carries */}
          {!financeBatchId && parse && mappedCenters.length > 0 && (
            <div className="mb-4 rounded-xl border border-ig-border-subtle p-3">
              <h4 className="text-xs font-semibold text-ig-fg-subtle mb-2 flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> Resumo a enviar ao Financeiro</h4>
              <div className="space-y-1">
                {mappedCenters.map((c) => (
                  <div key={c.cost_center_label} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{c.cost_center_label}</span>
                    {c.cost_center_id
                      ? <HudBadge variant="success">{financeCostCenters.find((f) => f.id === c.cost_center_id)?.name ?? c.cost_center_id}</HudBadge>
                      : <HudBadge variant="warning">não vinculado</HudBadge>}
                    <span className="w-28 text-right tabular-nums">{formatBRL(c.amount_cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {financeBatchId ? (
            <div className="rounded-xl border border-emerald-500/40 p-4">
              <div className="flex items-center gap-2 text-emerald-300 mb-2"><CheckCircle className="w-5 h-5" /> Lote criado: <code>{financeBatchId}</code></div>
              {financeHandoff.length > 0 && (
                <p className="text-xs text-ig-fg-subtle mb-2">
                  {financeHandoff.filter((l) => l.cost_center_id).length}/{financeHandoff.length} centro(s) de custo vinculado(s) enviado(s) — competência {parse?.competence_month}.
                </p>
              )}
              <Link href="/financeiro/folha-alocacao" className="inline-flex items-center gap-1 text-ig-accent text-sm">
                Abrir Folha & Alocação <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <HudButton variant="primary" isLoading={busy === 'finance'}
              disabled={unmappedCount > 0 && (!confirmUnmapped || overrideReason.trim().length === 0)}
              leftIcon={busy === 'finance' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} onClick={onSendToFinance}>
              Aprovar e enviar ao Financeiro
            </HudButton>
          )}
        </HudPanel>
      )}

      {/* Edit modal — competence / deadline / notes (only when editable) */}
      <HudModal isOpen={editOpen} onClose={() => setEditOpen(false)} title="Editar fechamento" subtitle="Competência, prazo e observações" size="md">
        <div className="space-y-3">
          <HudInput label="Competência (YYYY-MM)" value={competence} onChange={(e) => setCompetence(e.target.value)} placeholder="2026-05" />
          <HudInput label="Prazo de pagamento" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <label className="block text-sm">
            <span className="text-ig-fg-subtle">Observações</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="mt-1 w-full rounded-lg border border-ig-border-subtle bg-transparent px-3 py-2 text-sm" />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <HudButton variant="secondary" onClick={() => setEditOpen(false)}>Cancelar</HudButton>
            <HudButton variant="primary" isLoading={lifecycleBusy} onClick={saveEdit}>Salvar</HudButton>
          </div>
        </div>
      </HudModal>

      {/* Shared confirmation modal — delete / cancel / reopen / remove file */}
      <HudModal isOpen={!!confirmModal} onClose={() => { if (!lifecycleBusy) { setConfirmModal(null); setReasonText(''); } }} title={confirmModal?.title} size="md">
        {confirmModal && (
          <div className="space-y-3">
            <p className="text-sm text-ig-fg-subtle">{confirmModal.message}</p>
            {confirmModal.warning && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-200">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> {confirmModal.warning}
              </div>
            )}
            {confirmModal.requireReason && (
              <HudInput label="Motivo (registrado em auditoria)" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="Descreva o motivo" />
            )}
            <div className="flex justify-end gap-2 pt-1">
              <HudButton variant="secondary" onClick={() => { setConfirmModal(null); setReasonText(''); }}>Voltar</HudButton>
              <HudButton variant={confirmModal.destructive ? 'danger' : 'primary'} isLoading={lifecycleBusy}
                disabled={confirmModal.requireReason && reasonText.trim().length === 0}
                onClick={runConfirm}>
                {confirmModal.confirmLabel}
              </HudButton>
            </div>
          </div>
        )}
      </HudModal>
    </HudPageLayout>
  );
}

/** Status-gated action button: disabled with a tooltip reason when not allowed. */
function ActionButton({ icon, label, rule, onClick, destructive }: {
  icon: ReactNode; label: string; rule: ActionRule; onClick: () => void; destructive?: boolean;
}) {
  return (
    <HudButton variant="ghost" size="sm" leftIcon={icon}
      disabled={!rule.allowed} title={rule.allowed ? undefined : rule.reason}
      className={destructive && rule.allowed ? 'text-rose-300' : undefined}
      onClick={onClick}>
      {label}
    </HudButton>
  );
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone?: 'warning' }) {
  return (
    <div className="rounded-xl border border-ig-border-subtle p-3">
      <h5 className={`text-sm font-semibold mb-2 ${tone === 'warning' ? 'text-amber-300' : ''}`}>{title}</h5>
      {items.length === 0 ? (
        <p className="text-xs text-ig-fg-subtle">—</p>
      ) : (
        <ul className="space-y-1 text-sm list-disc pl-4">
          {items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      )}
    </div>
  );
}
