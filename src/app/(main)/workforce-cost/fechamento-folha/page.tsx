'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FileSpreadsheet, Upload, ScanLine, Sparkles, Paperclip, Send, Banknote,
  CheckCircle, AlertTriangle, ShieldAlert, Info, ArrowRight, Loader2,
} from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudPanel, HudButton, HudKpiStrip, HudStatusPill,
  HudBadge, type KpiItem, type HudStatusPillVariant,
} from '@/components/hud';
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
import type {
  PayrollClosingBatch, PayrollParseResult, PayrollNarrative, PayrollAttachment,
  PayrollEmailDispatch, PayrollImportFileType,
} from '@/lib/types/payroll-closing';

const STEPS = [
  { n: 1, label: 'Upload', icon: Upload },
  { n: 2, label: 'Validação', icon: ScanLine },
  { n: 3, label: 'Análise IA', icon: Sparkles },
  { n: 4, label: 'Anexos', icon: Paperclip },
  { n: 5, label: 'Envio', icon: Send },
  { n: 6, label: 'Financeiro', icon: Banknote },
] as const;

const UPLOAD_SLOTS: Array<{ type: PayrollImportFileType; label: string; accept: string; required?: boolean }> = [
  { type: 'payroll_spreadsheet', label: 'Planilha Geral da Folha', accept: '.xlsx,.xls,.csv', required: true },
  { type: 'bank_payment_spreadsheet', label: 'Planilha Bancária / Pagamento', accept: '.xlsx,.xls,.csv' },
  { type: 'holerite', label: 'Holerites Internos', accept: '.pdf,.zip' },
  { type: 'external_holerite', label: 'Holerites Externos / Avulsos', accept: '.pdf,.zip' },
  { type: 'supporting_document', label: 'Documentos de Apoio', accept: '*' },
];

const STATUS_VARIANT: Record<PayrollClosingBatch['status'], HudStatusPillVariant> = {
  imported: 'neutral',
  validated: 'info',
  reviewed: 'pending',
  approved: 'completed',
  sent_to_finance: 'completed',
  posted: 'completed',
  cancelled: 'error',
};

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

  const refreshAttachments = useCallback(async (batchId: string) => {
    setAttachments(await closing.getAttachments(batchId));
  }, []);

  // ── Step 1: create batch + upload ─────────────────────────
  const ensureBatch = useCallback(async (): Promise<PayrollClosingBatch> => {
    if (batch) return batch;
    const created = await closing.createBatch({ competence_month: competence, payment_deadline: deadline || undefined });
    setBatch(created);
    return created;
  }, [batch, competence, deadline]);

  const onUpload = useCallback(
    async (type: PayrollImportFileType, fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      if (type === 'payroll_spreadsheet') setPayrollFile(fileList[0]);
      try {
        const b = await ensureBatch();
        const files = Array.from(fileList);
        for (const file of files) {
          await closing.uploadFile(b.id, file, type);
        }
        await refreshAttachments(b.id);
        notify(`${files.length} arquivo(s) anexado(s)`, { variant: 'success', description: UPLOAD_SLOTS.find((s) => s.type === type)?.label });
      } catch (err) {
        notify('Falha no upload', { variant: 'error', description: err instanceof Error ? err.message : undefined });
      }
    },
    [ensureBatch, refreshAttachments, notify],
  );

  const uploadedByType = useMemo(() => {
    const map = new Map<string, number>();
    attachments.forEach((a) => map.set(a.file_type, (map.get(a.file_type) ?? 0) + 1));
    return map;
  }, [attachments]);

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
  }, [batch, payrollFile, competence, notify]);

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
      let current = batch;
      if (current.status !== 'approved' && current.status !== 'sent_to_finance') {
        const approved = await closing.approveBatch(current.id);
        if (approved) {
          current = approved;
          setBatch(approved);
        }
      }
      const result = await closing.sendToFinance(current.id);
      if (!result.ok) {
        notify('Não foi possível enviar ao Financeiro', { variant: 'error', description: result.error });
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
  }, [batch, notify]);

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

  const maxCc = useMemo(() => Math.max(1, ...(parse?.cost_centers.map((c) => c.amount_cents) ?? [1])), [parse]);

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
            {UPLOAD_SLOTS.map((slot) => (
              <div key={slot.type} className="rounded-xl border border-ig-border-subtle p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{slot.label}{slot.required && <span className="text-rose-400"> *</span>}</span>
                  {uploadedByType.get(slot.type) ? <HudBadge variant="success">{uploadedByType.get(slot.type)}</HudBadge> : null}
                </div>
                <input type="file" multiple accept={slot.accept}
                  onChange={(e) => onUpload(slot.type, e.target.files)}
                  className="block w-full text-xs text-ig-fg-subtle file:mr-3 file:rounded-lg file:border-0 file:bg-ig-accent-weak file:px-3 file:py-1.5 file:text-ig-fg-strong" />
              </div>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
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

              <div>
                <h4 className="text-sm font-semibold mb-2">Folha por Centro de Custo</h4>
                <div className="space-y-1.5">
                  {parse.cost_centers.length === 0 && <p className="text-sm text-ig-fg-subtle">Nenhum centro de custo detectado na planilha.</p>}
                  {parse.cost_centers.map((c) => (
                    <div key={c.cost_center_label} className="flex items-center gap-3">
                      <span className="w-44 truncate text-sm">{c.cost_center_label}</span>
                      <div className="flex-1 h-2 rounded bg-ig-border-subtle/40 overflow-hidden">
                        <div className="h-full bg-ig-accent" style={{ width: `${(c.amount_cents / maxCc) * 100}%` }} />
                      </div>
                      <span className="w-28 text-right text-sm tabular-nums">{formatBRL(c.amount_cents)}</span>
                      {!c.cost_center_id && <HudBadge variant="warning">não vinculado</HudBadge>}
                    </div>
                  ))}
                </div>
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

          {financeBatchId ? (
            <div className="rounded-xl border border-emerald-500/40 p-4">
              <div className="flex items-center gap-2 text-emerald-300 mb-2"><CheckCircle className="w-5 h-5" /> Lote criado: <code>{financeBatchId}</code></div>
              <Link href="/financeiro/folha-alocacao" className="inline-flex items-center gap-1 text-ig-accent text-sm">
                Abrir Folha & Alocação <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <HudButton variant="primary" isLoading={busy === 'finance'} leftIcon={busy === 'finance' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />} onClick={onSendToFinance}>
              Aprovar e enviar ao Financeiro
            </HudButton>
          )}
        </HudPanel>
      )}
    </HudPageLayout>
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
