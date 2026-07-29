'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileDown,
  FileText,
  Plus,
  Presentation,
  Save,
  Trash2,
} from 'lucide-react';
import {
  HudButton,
  HudCard,
  HudCardContent,
  HudCardDescription,
  HudCardHeader,
  HudCardTitle,
  HudHeader,
  HudInput,
  HudPageLayout,
  HudSelect,
  HudStatusPill,
  useHudToast,
} from '@/components/hud';
import { InvestorPackPreview } from '@/components/finance/investor-pack';
import { useCurrentUser } from '@/hooks/use-current-user';
import {
  addInvestorPackMonth,
  cloneInvestorPack,
  getInvestorPack,
  publishInvestorPack,
  saveInvestorPack,
  type InvestorPackActor,
} from '@/lib/finance/investor-pack/store';
import {
  formatInvestorCurrency,
  reaisToCents,
  validateInvestorPack,
} from '@/lib/finance/investor-pack/calculations';
import { downloadInvestorPackHtml } from '@/lib/finance/investor-pack/html-presentation';
import type { InvestorPack, InvestorPackMonth } from '@/lib/finance/investor-pack/types';
import { openInvestorPackPdf } from '@/lib/reports/modules/investor-pack-report';
import { cn } from '@/lib/utils';

const STEPS = ['Identificação', 'Valores mensais', 'Narrativa', 'Pré-visualização'];
const STATUS_LABEL = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' };

function TextAreaField({ label, value, onChange, rows = 5, disabled, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ig-fg-muted">{label}</span>
      <textarea
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-ig-border-default bg-ig-bg-raised/60 px-4 py-3 text-sm text-ig-fg-strong outline-none transition focus:border-ig-border-focus disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

export default function InvestorPackEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { notify } = useHudToast();
  const current = useCurrentUser();
  const [pack, setPack] = useState<InvestorPack | null>(null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const isAdmin = current.roles.some((role) => role.key === 'owner_admin');
  const canEdit = isAdmin || current.permissions.includes('finance.edit_entry');
  const canApprove = isAdmin || current.permissions.includes('finance.approve');
  const canExport = isAdmin || current.permissions.includes('finance.export');
  const editable = Boolean(pack?.status === 'draft' && canEdit);

  const actor: InvestorPackActor = useMemo(() => ({
    organizationId: current.organization?.id ?? null,
    userId: current.user?.id ?? null,
    authorName: current.profile?.full_name || current.user?.email || 'Financeiro',
  }), [current.organization?.id, current.profile?.full_name, current.user?.email, current.user?.id]);

  useEffect(() => {
    void getInvestorPack(params.id).then((loaded) => {
      setPack(loaded);
      if (!loaded) notify('Pack não encontrado', { variant: 'error' });
    });
  }, [notify, params.id]);

  const patch = (next: Partial<InvestorPack>) => {
    if (!editable) return;
    setPack((currentPack) => currentPack ? { ...currentPack, ...next } : currentPack);
  };

  const patchMonth = (id: string, next: Partial<InvestorPackMonth>) => {
    if (!editable) return;
    setPack((currentPack) => currentPack ? {
      ...currentPack,
      months: currentPack.months.map((month) => month.id === id ? { ...month, ...next } : month),
    } : currentPack);
  };

  const handleSave = async () => {
    if (!pack || !editable) return;
    setSaving(true);
    try {
      const saved = await saveInvestorPack(pack, actor);
      setPack(saved);
      notify('Rascunho salvo', { variant: 'success' });
    } catch (error) {
      notify('Falha ao salvar', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!pack || !canApprove) return;
    const validation = validateInvestorPack(pack);
    setErrors(validation.errors);
    if (!validation.valid) {
      notify('Revise o pack antes de publicar', { variant: 'error', description: validation.errors[0] });
      return;
    }
    if (!window.confirm('Publicar esta versão? O conteúdo ficará imutável e será usado nas exportações finais.')) return;
    setSaving(true);
    try {
      const published = await publishInvestorPack(pack, actor, canEdit);
      setPack(published);
      notify('Pack publicado', { variant: 'success', description: 'A versão agora está disponível para PDF, PowerPoint e HTML.' });
    } catch (error) {
      notify('Falha ao publicar', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    if (!pack || !canEdit) return;
    try {
      const clone = await cloneInvestorPack(pack, actor);
      router.push(`/financeiro/pack-investidor/${clone.id}`);
    } catch (error) {
      notify('Falha ao criar nova versão', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    }
  };

  const exportHtml = () => {
    if (!pack || pack.status !== 'published') return;
    if (!window.confirm('O HTML autônomo contém todos os dados deste pack. Compartilhe o arquivo como documento confidencial. Deseja continuar?')) return;
    downloadInvestorPackHtml(pack);
  };

  const exportPptx = async () => {
    if (!pack || pack.status !== 'published') return;
    setExporting('pptx');
    try {
      const response = await fetch('/api/finance/investor-pack/pptx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pack.id, pack }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || 'Falha ao gerar PowerPoint.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `pack-investidor-v${pack.version}.pptx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notify('Falha ao gerar PowerPoint', { variant: 'error', description: error instanceof Error ? error.message : 'Erro inesperado.' });
    } finally {
      setExporting(null);
    }
  };

  if (!pack) {
    return <HudPageLayout><div className="py-24 text-center text-sm text-ig-fg-muted">Carregando pack...</div></HudPageLayout>;
  }

  return (
    <HudPageLayout maxWidth="2xl">
      <HudHeader
        title={pack.title}
        subtitle={`${pack.company || 'Empresa não informada'} · Versão ${pack.version}`}
        icon={<FileText className="h-5 w-5" />}
        iconTint="#35E6BB"
        breadcrumbs={[
          { label: 'Financeiro', href: '/financeiro' },
          { label: 'Pack do Investidor', href: '/financeiro/pack-investidor' },
          { label: `Versão ${pack.version}` },
        ]}
        statusChips={[{ label: STATUS_LABEL[pack.status], variant: pack.status === 'published' ? 'success' : pack.status === 'archived' ? 'neutral' : 'warning' }]}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <HudButton variant="ghost" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/financeiro/pack-investidor')}>Voltar</HudButton>
            {editable && <HudButton variant="glass" isLoading={saving} leftIcon={<Save className="h-4 w-4" />} onClick={() => void handleSave()}>Salvar</HudButton>}
            {pack.status === 'draft' && canApprove && <HudButton variant="primary" leftIcon={<Check className="h-4 w-4" />} onClick={() => void handlePublish()}>Publicar</HudButton>}
            {pack.status !== 'draft' && canEdit && <HudButton variant="glass" leftIcon={<Copy className="h-4 w-4" />} onClick={() => void handleClone()}>Nova versão</HudButton>}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {STEPS.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => setStep(index)}
            className={cn(
              'rounded-xl border px-3 py-3 text-left transition',
              step === index
                ? 'border-ig-accent/50 bg-ig-accent/10 text-ig-fg-strong'
                : 'border-ig-border-subtle bg-ig-bg-raised/30 text-ig-fg-muted hover:border-ig-border-default',
            )}
          >
            <span className="block text-[10px] uppercase tracking-wider">Etapa {index + 1}</span>
            <span className="mt-0.5 block text-sm font-semibold">{label}</span>
          </button>
        ))}
      </div>

      {errors.length > 0 && (
        <div className="rounded-xl border border-ig-danger/30 bg-ig-danger/10 px-4 py-3 text-sm text-ig-danger">
          {errors.map((error) => <p key={error}>• {error}</p>)}
        </div>
      )}

      {step === 0 && (
        <HudCard>
          <HudCardHeader><HudCardTitle>Identificação do pack</HudCardTitle><HudCardDescription>Contexto que aparecerá nas capas e rodapés das apresentações.</HudCardDescription></HudCardHeader>
          <HudCardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><HudInput label="Título" value={pack.title} disabled={!editable} onChange={(event) => patch({ title: event.target.value })} /></div>
            <HudInput label="Empresa" value={pack.company} disabled={!editable} onChange={(event) => patch({ company: event.target.value })} />
            <HudInput label="Investidor / destinatário" value={pack.recipient} disabled={!editable} onChange={(event) => patch({ recipient: event.target.value })} />
            <HudInput label="Período inicial" type="month" value={pack.periodStart} disabled={!editable} onChange={(event) => patch({ periodStart: event.target.value })} />
            <HudInput label="Período final" type="month" value={pack.periodEnd} disabled={!editable} onChange={(event) => patch({ periodEnd: event.target.value })} />
            <HudInput label="Data-base" type="date" value={pack.referenceDate} disabled={!editable} onChange={(event) => patch({ referenceDate: event.target.value })} />
            <HudSelect
              label="Confidencialidade"
              value={pack.confidentiality}
              disabled={!editable}
              onChange={(value) => patch({ confidentiality: value as InvestorPack['confidentiality'] })}
              options={[
                { value: 'confidential', label: 'Confidencial' },
                { value: 'restricted', label: 'Uso restrito' },
                { value: 'public', label: 'Público' },
              ]}
            />
            <HudInput label="Moeda" value="BRL" disabled />
            <HudInput label="Autor" value={pack.authorName} disabled />
          </HudCardContent>
        </HudCard>
      )}

      {step === 1 && (
        <HudCard>
          <HudCardHeader className="flex-row items-center justify-between">
            <div><HudCardTitle>Valores mensais</HudCardTitle><HudCardDescription>Informe valores em reais; o sistema persiste os dados em centavos.</HudCardDescription></div>
            {editable && <HudButton variant="glass" size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => patch({ months: [...pack.months, addInvestorPackMonth(pack)] })}>Adicionar mês</HudButton>}
          </HudCardHeader>
          <HudCardContent className="overflow-x-auto p-0">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="border-b border-ig-border-subtle bg-ig-bg-raised/40 text-[10px] uppercase tracking-wider text-ig-fg-muted">
                <tr>
                  <th className="px-3 py-3 text-left">Competência</th>
                  <th className="px-3 py-3 text-right">Receita realizada</th>
                  <th className="px-3 py-3 text-right">Receita prevista</th>
                  <th className="px-3 py-3 text-right">Folha realizada</th>
                  <th className="px-3 py-3 text-right">Folha prevista</th>
                  <th className="px-3 py-3 text-left">Observação</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ig-border-subtle">
                {[...pack.months].sort((a, b) => a.period.localeCompare(b.period)).map((month) => (
                  <tr key={month.id} className="hover:bg-ig-bg-raised/25">
                    <td className="px-3 py-2"><input type="month" value={month.period} disabled={!editable} onChange={(event) => patchMonth(month.id, { period: event.target.value })} className="w-36 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-xs text-ig-fg-strong" /></td>
                    {([
                      ['revenueActualCents', month.revenueActualCents],
                      ['revenueForecastCents', month.revenueForecastCents],
                      ['payrollActualCents', month.payrollActualCents],
                      ['payrollForecastCents', month.payrollForecastCents],
                    ] as const).map(([key, value]) => (
                      <td key={key} className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={value / 100 || ''}
                          disabled={!editable}
                          aria-label={`${key} ${month.period}`}
                          onChange={(event) => patchMonth(month.id, { [key]: reaisToCents(event.target.value) })}
                          className="w-full min-w-36 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-right text-xs tabular-nums text-ig-fg-strong"
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2"><input value={month.note} disabled={!editable} onChange={(event) => patchMonth(month.id, { note: event.target.value })} className="w-full min-w-56 rounded-md border border-ig-border-subtle bg-ig-bg-raised/40 px-2 py-2 text-xs text-ig-fg-strong" placeholder="Contexto do mês" /></td>
                    <td className="px-2 py-2">{editable && <button type="button" aria-label={`Remover ${month.period}`} onClick={() => patch({ months: pack.months.filter((item) => item.id !== month.id) })} className="rounded-md p-2 text-ig-fg-muted hover:bg-ig-danger/10 hover:text-ig-danger"><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-ig-border-default bg-ig-bg-raised/35 text-xs font-semibold text-ig-fg-strong">
                <tr>
                  <td className="px-3 py-3">Totais</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(pack.months.reduce((sum, month) => sum + month.revenueActualCents, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(pack.months.reduce((sum, month) => sum + month.revenueForecastCents, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(pack.months.reduce((sum, month) => sum + month.payrollActualCents, 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{formatInvestorCurrency(pack.months.reduce((sum, month) => sum + month.payrollForecastCents, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </HudCardContent>
        </HudCard>
      )}

      {step === 2 && (
        <HudCard>
          <HudCardHeader><HudCardTitle>Narrativa executiva</HudCardTitle><HudCardDescription>Escreva para o investidor; uma linha por item nos campos de lista.</HudCardDescription></HudCardHeader>
          <HudCardContent className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <TextAreaField label="Resumo executivo" value={pack.narrative.executiveSummary} disabled={!editable} onChange={(value) => patch({ narrative: { ...pack.narrative, executiveSummary: value } })} placeholder="Explique o que os números significam para o investidor." />
            </div>
            <TextAreaField label="Destaques (uma linha por item)" value={pack.narrative.highlights.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...pack.narrative, highlights: value.split('\n') } })} />
            <TextAreaField label="Riscos (uma linha por item)" value={pack.narrative.risks.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...pack.narrative, risks: value.split('\n') } })} />
            <TextAreaField label="Premissas (uma linha por item)" value={pack.narrative.assumptions.join('\n')} disabled={!editable} onChange={(value) => patch({ narrative: { ...pack.narrative, assumptions: value.split('\n') } })} />
            <TextAreaField label="Mensagem final" value={pack.narrative.closingMessage} disabled={!editable} onChange={(value) => patch({ narrative: { ...pack.narrative, closingMessage: value } })} />
          </HudCardContent>
        </HudCard>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <InvestorPackPreview pack={pack} />
          <HudCard>
            <HudCardHeader><HudCardTitle>Apresentações</HudCardTitle><HudCardDescription>Arquivos finais usam exclusivamente o snapshot publicado.</HudCardDescription></HudCardHeader>
            <HudCardContent className="flex flex-wrap gap-2">
              {pack.status === 'published' ? (
                <>
                  <HudButton variant="primary" leftIcon={<Presentation className="h-4 w-4" />} onClick={() => router.push(`/financeiro/pack-investidor/${pack.id}/apresentar`)}>Apresentar HTML</HudButton>
                  {canExport && <HudButton variant="glass" leftIcon={<Download className="h-4 w-4" />} onClick={exportHtml}>Baixar HTML offline</HudButton>}
                  {canExport && <HudButton variant="glass" leftIcon={<FileDown className="h-4 w-4" />} onClick={() => {
                    const result = openInvestorPackPdf(pack);
                    if (!result.ok) notify('Falha ao gerar PDF', { variant: 'error', description: result.message });
                  }}>Gerar PDF</HudButton>}
                  {canExport && <HudButton variant="glass" isLoading={exporting === 'pptx'} leftIcon={<FileText className="h-4 w-4" />} onClick={() => void exportPptx()}>Baixar PowerPoint</HudButton>}
                </>
              ) : (
                <p className="text-sm text-ig-fg-muted">A pré-visualização está disponível. Publique esta versão para liberar os arquivos finais.</p>
              )}
            </HudCardContent>
          </HudCard>
        </div>
      )}

      <div className="flex items-center justify-between">
        <HudButton variant="ghost" leftIcon={<ChevronLeft className="h-4 w-4" />} disabled={step === 0} onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}>Anterior</HudButton>
        <span className="text-xs text-ig-fg-muted">{step + 1} de {STEPS.length}</span>
        <HudButton variant="ghost" rightIcon={<ChevronRight className="h-4 w-4" />} disabled={step === STEPS.length - 1} onClick={() => setStep((currentStep) => Math.min(STEPS.length - 1, currentStep + 1))}>Próxima</HudButton>
      </div>
    </HudPageLayout>
  );
}
