'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Calculator, Plus, Play, RotateCcw, CheckCircle } from 'lucide-react';
import {
  HudPageLayout, HudHeader, HudPanel, HudTable, HudButton,
  HudStatusPill, HudDrawer, HudInput, HudSelect, HudEmptyState,
  type HudTableColumn,
} from '@/components/hud';
import {
  getAllocationRules, createAllocationRule, getAllocationResults,
  previewAllocation, postAllocation, reverseAllocation,
  getCostCenters, formatBRL,
} from '@/lib/finance/finance-store';
import type { AllocationRule, AllocationResult, AllocationRuleTarget } from '@/lib/types/finance';

const RULE_STATUS: Record<string, string> = { draft: 'pending', active: 'completed', archived: 'error' };
const RESULT_STATUS: Record<string, string> = { preview: 'warning', posted: 'completed', reversed: 'error' };

const TAB_OPTIONS = [
  { value: 'rules', label: 'Regras de Alocação' },
  { value: 'run', label: 'Executar Alocação' },
  { value: 'history', label: 'Histórico' },
];

export default function AlocacaoPage() {
  const t = useTranslations('finance');
  const [activeTab, setActiveTab] = useState('rules');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [previewPeriod, setPreviewPeriod] = useState('2026-03');
  const [previewRuleId, setPreviewRuleId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [formName, setFormName] = useState('');
  const [formCC, setFormCC] = useState('');
  const [formMethod, setFormMethod] = useState('fixed_pct');
  const [formEffective, setFormEffective] = useState(new Date().toISOString().slice(0, 10));
  const [formTargets, setFormTargets] = useState<AllocationRuleTarget[]>([
    { target_project_id: 'proj-1', target_project_name: 'Petrobras FPSO P-80', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 50 },
    { target_project_id: 'proj-2', target_project_name: 'Shell FPSO Mero', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 30 },
    { target_project_id: 'proj-3', target_project_name: 'Equinor Bacalhau', target_cc_id: 'cc-eng-campo', target_cc_name: 'Engenharia de Campo', weight: 20 },
  ]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => getAllocationRules(), [refreshKey]);
  const results = useMemo(() => getAllocationResults(), [refreshKey]);

  const ruleColumns: HudTableColumn<AllocationRule>[] = [
    { key: 'name', header: t('ruleName'), cell: (r) => <span className="text-white/80 text-xs">{r.name}</span> },
    { key: 'cost_center_id', header: t('sourceCostCenter'), cell: (r) => <span className="text-white/60 text-xs">{r.cost_center?.name || r.cost_center_id}</span> },
    { key: 'method', header: t('method'), cell: (r) => <span className="text-white/60 text-xs">{r.method}</span> },
    { key: 'version', header: 'V', cell: (r) => <span className="text-white/40 text-xs">v{r.version}</span> },
    { key: 'effective_from', header: t('effectiveFrom'), cell: (r) => <span className="text-white/60 text-xs font-mono">{r.effective_from}</span> },
    { key: 'status', header: 'Status', cell: (r) => <HudStatusPill variant={RULE_STATUS[r.status] as any} size="sm">{r.status}</HudStatusPill> },
  ];

  const resultColumns: HudTableColumn<AllocationResult>[] = [
    { key: 'period_key', header: t('period'), cell: (r) => <span className="text-white/70 text-xs font-mono">{r.period_key}</span> },
    { key: 'rule_id', header: t('ruleName'), cell: (r) => <span className="text-white/70 text-xs">{r.rule?.name || r.rule_id}</span> },
    { key: 'source_amount_cents', header: 'Valor Origem', cell: (r) => <span className="text-white/80 text-xs font-mono">{formatBRL(r.source_amount_cents)}</span> },
    { key: 'result_entries', header: 'Destinos', cell: (r) => <span className="text-white/60 text-xs">{r.result_entries.length} projetos</span> },
    { key: 'status', header: 'Status', cell: (r) => <HudStatusPill variant={RESULT_STATUS[r.status] as any} size="sm">{r.status}</HudStatusPill> },
    { key: 'actions', header: '', cell: (r) => r.status === 'preview' ? (
      <HudButton variant="primary" size="sm" leftIcon={<CheckCircle className="w-3.5 h-3.5" />}
        onClick={(e) => { e.stopPropagation(); postAllocation(r.id); setRefreshKey(k => k + 1); }}>
        Postar
      </HudButton>
    ) : r.status === 'posted' ? (
      <HudButton variant="danger" size="sm" leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
        onClick={(e) => { e.stopPropagation(); reverseAllocation(r.id, 'Correção manual'); setRefreshKey(k => k + 1); }}>
        Reverter
      </HudButton>
    ) : null },
  ];

  const handleSaveRule = () => {
    if (!formName || !formCC) return;
    createAllocationRule({ name: formName, cost_center_id: formCC, method: formMethod as any, rules_json: formTargets, effective_from: formEffective });
    setDrawerOpen(false);
    setRefreshKey(k => k + 1);
  };

  const handleRunPreview = () => {
    if (!previewRuleId) return;
    previewAllocation(previewRuleId, previewPeriod);
    setRefreshKey(k => k + 1);
    setActiveTab('history');
  };

  const totalWeight = formTargets.reduce((s, tgt) => s + tgt.weight, 0);

  return (
    <HudPageLayout>
      <HudHeader
        title={t('allocation')}
        icon={<Calculator className="w-5 h-5" />}
        breadcrumbs={[{ label: t('title'), href: '/financeiro' }, { label: t('allocation') }]}
        actions={
          <HudButton variant="primary" leftIcon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
            {t('newRule')}
          </HudButton>
        }
      />

      <div className="flex gap-1.5 mt-4">
        {TAB_OPTIONS.map(tab => (
          <button key={tab.value} onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider transition-all ${
              activeTab === tab.value
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 finance-tab-active'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.06] hover:bg-white/[0.06] finance-tab-inactive'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === 'rules' && (
          rules.length === 0 ? (
            <HudEmptyState title="Nenhuma regra de alocação" description="Crie uma nova regra de alocação." icon="package"
              action={{ label: t('newRule'), onClick: () => setDrawerOpen(true) }} />
          ) : (
            <HudTable columns={ruleColumns} data={rules} keyExtractor={(r) => r.id} compact stickyHeader />
          )
        )}

        {activeTab === 'run' && (
          <HudPanel title={t('runAllocation')} icon={<Play className="w-4 h-4" />}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <HudSelect label={t('period')} value={previewPeriod} onChange={setPreviewPeriod}
                  options={[{ value: '2026-01', label: 'Jan/2026' }, { value: '2026-02', label: 'Fev/2026' }, { value: '2026-03', label: 'Mar/2026' }]} />
                <HudSelect label={t('allocationRules')} value={previewRuleId} onChange={setPreviewRuleId}
                  options={[{ value: '', label: 'Selecionar regra...' }, ...rules.filter(r => r.status === 'active').map(r => ({ value: r.id, label: r.name }))]} />
              </div>
              <HudButton variant="primary" leftIcon={<Play className="w-4 h-4" />} onClick={handleRunPreview} disabled={!previewRuleId}>
                {t('simulate')}
              </HudButton>
            </div>
          </HudPanel>
        )}

        {activeTab === 'history' && (
          results.length === 0 ? (
            <HudEmptyState title="Nenhuma alocação executada" description="Execute uma alocação na aba anterior." icon="package" />
          ) : (
            <HudTable columns={resultColumns} data={results} keyExtractor={(r) => r.id} compact stickyHeader />
          )
        )}
      </div>

      <HudDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={t('newRule')} width="lg">
        <div className="space-y-4">
          <HudInput label={t('ruleName')} value={formName} onChange={(e) => setFormName(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <HudSelect label={t('sourceCostCenter')} value={formCC} onChange={setFormCC}
              options={[{ value: '', label: 'Selecionar...' }, ...getCostCenters().map(c => ({ value: c.id, label: `${c.code} — ${c.name}` }))]} />
            <HudSelect label={t('method')} value={formMethod} onChange={setFormMethod}
              options={[{ value: 'fixed_pct', label: t('methodFixedPct') }, { value: 'headcount', label: t('methodHeadcount') }, { value: 'revenue', label: t('methodRevenue') }]} />
          </div>
          <HudInput label={t('effectiveFrom')} type="date" value={formEffective} onChange={(e) => setFormEffective(e.target.value)} />
          <div>
            <p className="text-white/40 text-[10px] uppercase tracking-wider mb-2">{t('distribution')} ({totalWeight}%)</p>
            {totalWeight !== 100 && <p className="text-amber-400 text-xs mb-2">A soma dos pesos deve ser 100%</p>}
            <div className="space-y-2">
              {formTargets.map((target, i) => (
                <div key={i} className="grid grid-cols-3 gap-2 items-end">
                  <HudInput label={i === 0 ? t('targetProject') : ''} value={target.target_project_name || ''} onChange={(e) => {
                    const updated = [...formTargets]; updated[i] = { ...updated[i], target_project_name: e.target.value }; setFormTargets(updated);
                  }} />
                  <HudInput label={i === 0 ? t('targetCostCenter') : ''} value={target.target_cc_name || ''} onChange={(e) => {
                    const updated = [...formTargets]; updated[i] = { ...updated[i], target_cc_name: e.target.value }; setFormTargets(updated);
                  }} />
                  <HudInput label={i === 0 ? t('weight') : ''} type="number" value={String(target.weight)} onChange={(e) => {
                    const updated = [...formTargets]; updated[i] = { ...updated[i], weight: parseFloat(e.target.value) || 0 }; setFormTargets(updated);
                  }} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <HudButton variant="secondary" onClick={() => setDrawerOpen(false)} fullWidth>Cancelar</HudButton>
            <HudButton variant="primary" onClick={handleSaveRule} fullWidth disabled={totalWeight !== 100}>Salvar Regra</HudButton>
          </div>
        </div>
      </HudDrawer>
    </HudPageLayout>
  );
}
