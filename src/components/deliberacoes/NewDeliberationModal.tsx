'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { HudInput, hudInputBase } from '@/components/ui/hud-input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { PrimaryCTA } from '@/components/ui/primary-cta';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { COMMITTEES, DELIBERATION_TEMPLATES, buildStagePlan, resolveTemplate } from '@/lib/deliberations-policy';
import { DeliberationStage } from '@/lib/types';
import { cn } from '@/lib/utils';

export type NewDeliberationPayload = {
  title: string;
  description: string;
  templateId: string;
  businessArea: string;
  financialImpact: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  strategicFlag: boolean;
  outsideBudget: boolean;
  marginPercent: number;
  aggressivePaymentTerms: boolean;
  ownerCommitteeId: string;
  ownerCommitteeName: string;
  dependentCommitteeIds: string[];
  dependentCommitteeNames: string[];
  stages: DeliberationStage[];
};

interface NewDeliberationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateDeliberation: (payload: NewDeliberationPayload) => void;
}

export function NewDeliberationModal({ open, onOpenChange, onCreateDeliberation }: NewDeliberationModalProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    title: '',
    description: '',
    templateId: DELIBERATION_TEMPLATES[0]?.id ?? '',
    businessArea: 'HR',
    financialImpact: 0,
    riskLevel: 'medium' as 'low' | 'medium' | 'high' | 'critical',
    strategicFlag: false,
    outsideBudget: false,
    marginPercent: 30,
    aggressivePaymentTerms: false,
  });

  const template = useMemo(() => resolveTemplate(form.templateId), [form.templateId]);
  const stages = useMemo(() => {
    if (!template) return [];
    return buildStagePlan({
      ownerCommitteeId: template.ownerCommitteeId,
      financialImpact: form.financialImpact,
      riskLevel: form.riskLevel,
      strategicFlag: form.strategicFlag,
      outsideBudget: form.outsideBudget,
      marginPercent: form.marginPercent,
      aggressivePaymentTerms: form.aggressivePaymentTerms,
    });
  }, [template, form.financialImpact, form.riskLevel, form.strategicFlag, form.outsideBudget, form.marginPercent, form.aggressivePaymentTerms]);

  const dependentCommittees = useMemo(() => {
    return stages
      .filter((stage) => stage.stageType === 'dependent_review')
      .map((stage) => ({ id: stage.committeeId, name: stage.committeeName }));
  }, [stages]);

  const majorityTypeLabel: Record<string, string> = {
    simple_majority: 'Maioria simples',
    qualified_two_thirds: 'Qualificada 2/3',
    unanimity: 'Unanimidade',
  };

  const handleCreate = () => {
    if (!template) return;
    const owner = COMMITTEES.find((committee) => committee.id === template.ownerCommitteeId);
    onCreateDeliberation({
      title: form.title || 'Deliberação sem título',
      description: form.description,
      templateId: form.templateId,
      businessArea: form.businessArea,
      financialImpact: form.financialImpact,
      riskLevel: form.riskLevel,
      strategicFlag: form.strategicFlag,
      outsideBudget: form.outsideBudget,
      marginPercent: form.marginPercent,
      aggressivePaymentTerms: form.aggressivePaymentTerms,
      ownerCommitteeId: template.ownerCommitteeId,
      ownerCommitteeName: owner?.name ?? 'Comitê Responsável',
      dependentCommitteeIds: dependentCommittees.map((item) => item.id),
      dependentCommitteeNames: dependentCommittees.map((item) => item.name),
      stages,
    });
    setStep(1);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px] bg-gradient-to-br from-[#08130F] to-[#040A08] border-[rgba(255,255,255,0.12)]">
        <DialogHeader>
        <DialogTitle className="text-xl text-white">Nova Deliberação</DialogTitle>
        <DialogDescription className="text-[rgba(255,255,255,0.6)]">
          Etapa {step} de 2: {step === 1 ? 'Proposta' : 'Governança & Votação'}
        </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Modelo</Label>
                <Select value={form.templateId} onValueChange={(value) => setForm((prev) => ({ ...prev, templateId: value }))}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.1)] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#07120E] border-[rgba(255,255,255,0.12)] text-white">
                    {DELIBERATION_TEMPLATES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Área de Negócio</Label>
                <Select value={form.businessArea} onValueChange={(value) => setForm((prev) => ({ ...prev, businessArea: value }))}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.1)] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#07120E] border-[rgba(255,255,255,0.12)] text-white">
                  <SelectItem value="HR">RH</SelectItem>
                  <SelectItem value="Finance">Financeiro</SelectItem>
                  <SelectItem value="R&D">P&D</SelectItem>
                  <SelectItem value="Sales">Vendas</SelectItem>
                  <SelectItem value="Risk">Riscos</SelectItem>
                  <SelectItem value="Legal">Jurídico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Título</Label>
              <HudInput
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Informe o título da deliberação"
              />
            </div>

            <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Resumo da Proposta</Label>
              <Textarea
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                rows={5}
                className={cn(hudInputBase, 'min-h-[130px]')}
                placeholder="Descreva o assunto, evidências e a decisão solicitada"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Impacto Orçamentário</Label>
                <HudInput
                  type="number"
                  value={String(form.financialImpact)}
                  onChange={(event) => setForm((prev) => ({ ...prev, financialImpact: Number(event.target.value || 0) }))}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Nível de Risco</Label>
                <Select value={form.riskLevel} onValueChange={(value: 'low' | 'medium' | 'high' | 'critical') => setForm((prev) => ({ ...prev, riskLevel: value }))}>
                  <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.1)] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#07120E] border-[rgba(255,255,255,0.12)] text-white">
                    <SelectItem value="low">Baixo</SelectItem>
                    <SelectItem value="medium">Médio</SelectItem>
                    <SelectItem value="high">Alto</SelectItem>
                    <SelectItem value="critical">Crítico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[rgba(255,255,255,0.85)]">Margem (%)</Label>
                <HudInput
                  type="number"
                  value={String(form.marginPercent)}
                  onChange={(event) => setForm((prev) => ({ ...prev, marginPercent: Number(event.target.value || 0) }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <label className="flex items-center justify-between px-3 py-2 rounded-md border border-[rgba(255,255,255,0.1)]">
                <span className="text-sm text-[rgba(255,255,255,0.78)]">Indicador Estratégico</span>
                <Switch checked={form.strategicFlag} onCheckedChange={(value) => setForm((prev) => ({ ...prev, strategicFlag: value }))} />
              </label>
              <label className="flex items-center justify-between px-3 py-2 rounded-md border border-[rgba(255,255,255,0.1)]">
                <span className="text-sm text-[rgba(255,255,255,0.78)]">Fora do Orçamento</span>
                <Switch checked={form.outsideBudget} onCheckedChange={(value) => setForm((prev) => ({ ...prev, outsideBudget: value }))} />
              </label>
              <label className="flex items-center justify-between px-3 py-2 rounded-md border border-[rgba(255,255,255,0.1)]">
                <span className="text-sm text-[rgba(255,255,255,0.78)]">Condições Agressivas</span>
                <Switch checked={form.aggressivePaymentTerms} onCheckedChange={(value) => setForm((prev) => ({ ...prev, aggressivePaymentTerms: value }))} />
              </label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-[rgba(255,255,255,0.1)] p-4 bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)] mb-2">Comitê Responsável</p>
              <p className="text-white font-medium">{stages[0]?.committeeName ?? 'Não definido'}</p>
            </div>

            <div className="rounded-lg border border-[rgba(255,255,255,0.1)] p-4 bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)] mb-2">Revisões Necessárias</p>
              {dependentCommittees.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {dependentCommittees.map((committee) => (
                    <span key={committee.id} className="px-2 py-1 rounded bg-[rgba(0,255,180,0.12)] text-[#00FFB4] text-xs">
                      {committee.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[rgba(255,255,255,0.6)]">Nenhum comitê dependente exigido pela política.</p>
              )}
            </div>

            <div className="rounded-lg border border-[rgba(255,255,255,0.1)] p-4 bg-[rgba(255,255,255,0.02)]">
              <p className="text-xs uppercase tracking-wide text-[rgba(255,255,255,0.5)] mb-2">Regras de Votação</p>
              {stages.filter((stage) => stage.stageType !== 'execution').map((stage) => (
                <div key={stage.id} className="text-sm text-[rgba(255,255,255,0.78)] mb-2">
                  <strong className="text-white">{stage.committeeName}</strong>
                  {` - Quórum ${stage.votingRule.quorumPercent}% | ${majorityTypeLabel[stage.votingRule.majorityType] ?? stage.votingRule.majorityType} | Janela de votação ${stage.votingRule.votingWindowHours}h`}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2">
          <div>
            {step === 2 && (
              <SecondaryButton onClick={() => setStep(1)}>
                Voltar para Proposta
              </SecondaryButton>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-[rgba(255,255,255,0.7)]">
              Cancelar
            </Button>
            {step === 1 ? (
              <PrimaryCTA onClick={() => setStep(2)}>Continuar para Governança & Votação</PrimaryCTA>
            ) : (
              <PrimaryCTA onClick={handleCreate}>Criar Deliberação</PrimaryCTA>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
