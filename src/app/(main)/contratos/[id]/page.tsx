'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { excelContracts } from '@/data/contractsFromExcel.generated';
import { getProjects } from '@/lib/services/projects';
import type { Project } from '@/lib/types';
import {
  enrichContractsForGovernance,
  formatCurrencyCompact,
  formatCurrencyFull,
  type ContractGovernanceRecord,
} from '@/components/contracts/contract-governance-data';
import {
  HudBadge,
  HudButton,
  HudHeader,
  HudKpiStrip,
  HudPageLayout,
  HudPanel,
  HudProgressBar,
  HudStatusPill,
  HudTabs,
  type HudTab,
  type KpiItem,
} from '@/components/hud';
import {
  ArrowLeft,
  Archive,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSearch,
  FileSignature,
  FileText,
  GanttChartSquare,
  Receipt,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

type DetailTab = 'summary' | 'clauses' | 'obligations' | 'risks' | 'finance' | 'documents' | 'audit' | 'ai';

const riskLabels = { high: 'Alto', medium: 'Médio', low: 'Baixo' } as const;

function riskVariant(risk: ContractGovernanceRecord['contract']['riskClassification']) {
  return risk === 'high' ? 'critical' : risk === 'medium' ? 'warning' : 'active';
}

export default function ContractDossierPage() {
  const params = useParams();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<DetailTab>('summary');

  useEffect(() => {
    setProjects(getProjects());
  }, []);

  const records = useMemo(() => enrichContractsForGovernance(excelContracts, projects), [projects]);
  const record = useMemo(() => {
    const id = String(params.id || '');
    return records.find((item) => item.contract.id === id) || records[0] || null;
  }, [params.id, records]);

  if (!record) {
    return (
      <HudPageLayout>
        <HudPanel title="Contrato não encontrado" interactive={false}>
          <HudButton variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/contratos')}>
            Voltar para contratos
          </HudButton>
        </HudPanel>
      </HudPageLayout>
    );
  }

  const kpis: KpiItem[] = [
    { id: 'total', label: 'Valor total', value: formatCurrencyCompact(record.totalValue), variant: 'info', icon: <FileSignature className="h-4 w-4" /> },
    { id: 'billed', label: 'Faturado', value: formatCurrencyCompact(record.billedValue), variant: 'success', icon: <Receipt className="h-4 w-4" /> },
    { id: 'remaining', label: 'Saldo', value: formatCurrencyCompact(record.remainingValue), variant: 'warning', icon: <GanttChartSquare className="h-4 w-4" /> },
    { id: 'renewal', label: 'Vencimento', value: record.daysUntilExpiration === null ? 'sem data' : record.daysUntilExpiration < 0 ? 'vencido' : `${record.daysUntilExpiration}d`, variant: record.daysUntilExpiration !== null && record.daysUntilExpiration <= 90 ? 'warning' : 'default', icon: <CalendarClock className="h-4 w-4" /> },
    { id: 'risk', label: 'Risk score', value: `${record.riskScore}/100`, variant: record.riskScore >= 70 ? 'danger' : record.riskScore >= 50 ? 'warning' : 'success', icon: <ShieldAlert className="h-4 w-4" /> },
  ];

  const tabs: HudTab[] = [
    { id: 'summary', label: 'Resumo', icon: <FileText className="h-4 w-4" />, content: <SummaryTab record={record} /> },
    { id: 'clauses', label: 'Cláusulas', icon: <Scale className="h-4 w-4" />, content: <ClausesTab record={record} /> },
    { id: 'obligations', label: 'Obrigações', icon: <ClipboardCheck className="h-4 w-4" />, badge: record.obligations.filter((item) => item.status === 'overdue').length, content: <ObligationsTab record={record} /> },
    { id: 'risks', label: 'Riscos', icon: <ShieldAlert className="h-4 w-4" />, content: <RisksTab record={record} /> },
    { id: 'finance', label: 'Financeiro', icon: <Receipt className="h-4 w-4" />, content: <FinanceTab record={record} /> },
    { id: 'documents', label: 'Documentos', icon: <Archive className="h-4 w-4" />, badge: record.missingDocuments.length, content: <DocumentsTab record={record} /> },
    { id: 'audit', label: 'Auditoria', icon: <ShieldCheck className="h-4 w-4" />, content: <AuditTab record={record} /> },
    { id: 'ai', label: 'Análise IA', icon: <BrainCircuit className="h-4 w-4" />, content: <AiTab record={record} /> },
  ];

  return (
    <HudPageLayout>
      <HudHeader
        title={record.contract.name}
        subtitle="Dossiê contratual com vínculos, exposição financeira, obrigações, riscos, documentos, auditoria e análise IA mock/pendente."
        icon={<FileSignature className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Contratos', href: '/contratos' }, { label: record.code }]}
        statusChips={[
          { label: `Risco ${riskLabels[record.contract.riskClassification]}`, variant: record.contract.riskClassification === 'high' ? 'critical' : record.contract.riskClassification === 'medium' ? 'warning' : 'success' },
          { label: record.contract.status === 'expired' ? 'Expirado' : record.contract.status === 'expiring_soon' ? 'Expirando' : 'Ativo', variant: record.contract.status === 'expired' ? 'critical' : record.contract.status === 'expiring_soon' ? 'warning' : 'success' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <HudButton variant="secondary" size="md" leftIcon={<ArrowLeft className="h-4 w-4" />} onClick={() => router.push('/contratos')}>
              Voltar
            </HudButton>
            <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />}>
              Documento
            </HudButton>
          </div>
        }
      />

      <HudKpiStrip kpis={kpis} columns={5} connected size="sm" />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <HudTabs
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId as DetailTab)}
            variant="underline"
          />
        </div>
        <SideTimeline record={record} />
      </div>
    </HudPageLayout>
  );
}

function SummaryTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
      <HudPanel title="Resumo executivo" icon={<FileText className="h-4 w-4" />} interactive={false}>
        <div className="space-y-4">
          <p className="text-ig-body-sm leading-relaxed text-ig-fg-muted">
            Este dossiê centraliza o contrato como fonte de verdade documental e de governança. Empresas e projetos aparecem como vínculos de referência, sem duplicar seus cadastros.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Código" value={record.code} />
            <Metric label="Tipo" value={record.contractType} />
            <Metric label="Empresa vinculada" value={record.companyName} />
            <Metric label="Responsável" value={record.owner} />
          </div>
          {record.contract.notes && (
            <div className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <p className="text-ig-label text-ig-fg-muted">Observações</p>
              <p className="mt-1 text-ig-body-sm text-ig-fg-strong">{record.contract.notes}</p>
            </div>
          )}
        </div>
      </HudPanel>

      <HudPanel title="Entidades relacionadas" icon={<Workflow className="h-4 w-4" />} interactive={false}>
        <div className="space-y-3">
          <Relation icon={<Building2 className="h-4 w-4" />} label="Empresa" value={record.companyReference} />
          {record.project ? (
            <Link href={`/projetos/${record.project.id}`}>
              <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value={record.projectReference} link />
            </Link>
          ) : (
            <Relation icon={<Workflow className="h-4 w-4" />} label="Projeto" value="Sem projeto vinculado" />
          )}
          <Relation icon={<Receipt className="h-4 w-4" />} label="Financeiro" value="Referência de faturamento e backlog" />
          <Relation icon={<ShieldCheck className="h-4 w-4" />} label="Aprovação" value={record.approvalRoute} />
        </div>
      </HudPanel>
    </div>
  );
}

function ClausesTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <HudPanel title="Cláusulas monitoradas" icon={<Scale className="h-4 w-4" />} interactive={false}>
      <div className="grid gap-3 md:grid-cols-2">
        {record.clauses.map((clause) => (
          <div key={clause.id} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{clause.title}</p>
                <p className="mt-1 text-ig-caption text-ig-fg-muted">{clause.category} · {clause.status === 'mapped' ? 'Mapeada' : clause.status === 'review' ? 'Em revisão' : 'Ausente'}</p>
              </div>
              <HudStatusPill variant={riskVariant(clause.risk)} size="sm">{riskLabels[clause.risk]}</HudStatusPill>
            </div>
            <p className="mt-3 text-ig-caption leading-relaxed text-ig-fg-muted">{clause.note}</p>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function ObligationsTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <HudPanel title="Obrigações por responsável" icon={<ClipboardCheck className="h-4 w-4" />} interactive={false}>
      <div className="space-y-2">
        {record.obligations.map((obligation) => (
          <div key={obligation.id} className="grid gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3 md:grid-cols-[1fr_180px_120px_130px] md:items-center">
            <div className="min-w-0">
              <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{obligation.title}</p>
              <p className="truncate text-ig-caption text-ig-fg-muted">{obligation.evidence}</p>
            </div>
            <span className="truncate text-ig-body-sm text-ig-fg-muted">{obligation.owner}</span>
            <HudStatusPill variant={obligation.status === 'overdue' ? 'critical' : obligation.status === 'due_soon' ? 'warning' : obligation.status === 'done' ? 'active' : 'neutral'} size="sm">
              {obligation.status === 'overdue' ? 'Atrasada' : obligation.status === 'due_soon' ? 'Próxima' : obligation.status === 'done' ? 'Concluída' : 'Aberta'}
            </HudStatusPill>
            <span className="text-ig-caption text-ig-fg-muted">{format(new Date(obligation.dueDate), 'dd/MM/yyyy', { locale: pt })}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function RisksTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <HudPanel title="Risk score" icon={<ShieldAlert className="h-4 w-4" />} interactive={false}>
        <div className="text-center">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border border-ig-border-focus bg-ig-accent-weak">
            <span className="text-3xl font-semibold tabular-nums text-ig-accent">{record.riskScore}</span>
          </div>
          <p className="mt-3 text-ig-body-sm font-semibold text-ig-fg-strong">Classificação {riskLabels[record.contract.riskClassification]}</p>
          <p className="mt-1 text-ig-caption text-ig-fg-muted">Score derivado de risco cadastral, vencimento e documentos faltantes.</p>
        </div>
      </HudPanel>
      <HudPanel title="Riscos legais e financeiros" icon={<Scale className="h-4 w-4" />} interactive={false}>
        <div className="grid gap-3 md:grid-cols-2">
          <Metric label="Status jurídico" value={record.legalStatus === 'approved' ? 'Aprovado' : record.legalStatus === 'review' ? 'Em revisão' : 'Pendente'} />
          <Metric label="Status financeiro" value={record.financialStatus === 'ok' ? 'Sem bloqueio' : record.financialStatus === 'attention' ? 'Atenção' : 'Bloqueado'} />
          <Metric label="Cláusulas de alto risco" value={record.clauses.filter((clause) => clause.risk === 'high').length} />
          <Metric label="Documentos faltantes" value={record.missingDocuments.length} />
        </div>
      </HudPanel>
    </div>
  );
}

function FinanceTab({ record }: { record: ContractGovernanceRecord }) {
  const billedPercent = record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0;
  return (
    <HudPanel title="Exposição financeira" icon={<Receipt className="h-4 w-4" />} interactive={false}>
      <div className="grid gap-4 lg:grid-cols-3">
        <Metric label="Valor total" value={formatCurrencyFull(record.totalValue, record.contract.currency)} />
        <Metric label="Valor faturado" value={formatCurrencyFull(record.billedValue, record.contract.currency)} />
        <Metric label="Saldo contratual" value={formatCurrencyFull(record.remainingValue, record.contract.currency)} />
      </div>
      <div className="mt-5 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-4">
        <div className="mb-2 flex justify-between text-ig-body-sm">
          <span className="text-ig-fg-muted">Execução financeira</span>
          <span className="font-semibold tabular-nums text-ig-fg-strong">{billedPercent}%</span>
        </div>
        <HudProgressBar value={billedPercent} variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'} />
      </div>
    </HudPanel>
  );
}

function DocumentsTab({ record }: { record: ContractGovernanceRecord }) {
  const documents = record.missingDocuments.length ? record.missingDocuments : ['Documento assinado', 'Matriz de obrigações', 'Parecer jurídico'];
  return (
    <HudPanel title="Repositório documental" icon={<Archive className="h-4 w-4" />} interactive={false}>
      <div className="grid gap-3 md:grid-cols-2">
        {documents.map((document) => {
          const missing = record.missingDocuments.includes(document);
          return (
            <div key={document} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{document}</p>
                  <p className="mt-1 text-ig-caption text-ig-fg-muted">{missing ? 'Pendente para completar dossiê' : 'Referência documental disponível'}</p>
                </div>
                <HudBadge variant={missing ? 'warning' : 'success'} size="sm">{missing ? 'faltante' : 'ok'}</HudBadge>
              </div>
            </div>
          );
        })}
      </div>
    </HudPanel>
  );
}

function AuditTab({ record }: { record: ContractGovernanceRecord }) {
  return (
    <HudPanel title="Auditoria do contrato" icon={<ShieldCheck className="h-4 w-4" />} interactive={false}>
      <Timeline events={record.auditEvents.map((event) => ({
        title: event.title,
        actor: event.actor,
        date: event.at,
        status: event.status,
      }))} />
    </HudPanel>
  );
}

function AiTab({ record }: { record: ContractGovernanceRecord }) {
  const output = [
    'Resumo executivo',
    'Cláusulas-chave',
    'Pagamento',
    'Renovação e rescisão',
    'Penalidades e multas',
    'SLA',
    'Riscos legais',
    'Riscos financeiros',
    'Informações faltantes',
    'Documentos requeridos',
    'Ações sugeridas',
    'Rota de aprovação',
  ];

  return (
    <HudPanel title="Análise IA assistida" subtitle="Estado mock/pendente, sem chamada de API" icon={<BrainCircuit className="h-4 w-4" />} interactive={false}>
      <div className="mb-4 rounded-lg border border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] p-3">
        <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Análise não conectada</p>
        <p className="mt-1 text-ig-caption text-ig-fg-muted">Os campos abaixo são estrutura de produto para integração futura. Nenhuma leitura documental real foi executada.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Confiança mock" value={`${record.confidenceScore}%`} />
        <Metric label="Risk score" value={`${record.riskScore}/100`} />
        <Metric label="Rota recomendada" value={record.approvalRoute} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {output.map((item) => (
          <div key={item} className="rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{item}</p>
              <HudBadge variant="neutral" size="sm">mock pendente</HudBadge>
            </div>
            <p className="mt-2 text-ig-caption text-ig-fg-muted">Aguardando motor de IA e documento fonte.</p>
          </div>
        ))}
      </div>
    </HudPanel>
  );
}

function SideTimeline({ record }: { record: ContractGovernanceRecord }) {
  const events = [
    { title: 'Uploaded', actor: record.owner, date: record.contract.uploadedAt, status: 'done' as const },
    { title: 'Analyzed', actor: 'INSIGHT AI mock', date: record.auditEvents[1]?.at || record.contract.uploadedAt, status: 'warning' as const },
    { title: 'Reviewed', actor: 'Jurídico Corporativo', date: record.auditEvents[2]?.at || record.contract.uploadedAt, status: record.legalStatus === 'approved' ? 'done' as const : 'pending' as const },
    { title: 'Approved', actor: record.approvalRoute, date: record.contract.signingDate || record.contract.uploadedAt, status: record.legalStatus === 'approved' ? 'done' as const : 'pending' as const },
    { title: 'Renewed', actor: 'Gestão de Contratos', date: record.contract.renewalDate || record.contract.expirationDate || record.contract.uploadedAt, status: 'pending' as const },
    { title: 'Expired', actor: 'Sistema', date: record.contract.expirationDate || record.contract.uploadedAt, status: record.contract.status === 'expired' ? 'warning' as const : 'pending' as const },
  ];

  return (
    <HudPanel title="Timeline auditável" subtitle={record.code} icon={<CalendarClock className="h-4 w-4" />} interactive={false} className="xl:sticky xl:top-5">
      <Timeline events={events} />
    </HudPanel>
  );
}

function Timeline({
  events,
}: {
  events: Array<{ title: string; actor: string; date: Date; status: 'done' | 'warning' | 'pending' }>;
}) {
  return (
    <div className="relative space-y-3">
      <div className="absolute bottom-0 left-[15px] top-0 w-px bg-ig-border-subtle" />
      {events.map((event) => (
        <div key={`${event.title}-${event.actor}`} className="relative flex gap-3">
          <span className={`mt-1 h-8 w-8 shrink-0 rounded-full border bg-ig-panel ${event.status === 'done' ? 'border-[color-mix(in_oklab,var(--ig-success)_40%,transparent)]' : event.status === 'warning' ? 'border-[color-mix(in_oklab,var(--ig-warning)_40%,transparent)]' : 'border-ig-border-strong'}`} />
          <div className="min-w-0 flex-1 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
            <p className="truncate text-ig-body-sm font-semibold text-ig-fg-strong">{event.title}</p>
            <p className="truncate text-ig-caption text-ig-fg-muted">{event.actor}</p>
            <p className="mt-1 text-ig-caption text-ig-fg-subtle">{format(new Date(event.date), 'dd/MM/yyyy', { locale: pt })}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Relation({ icon, label, value, link = false }: { icon: React.ReactNode; label: string; value: string; link?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ig-border-subtle bg-ig-panel text-ig-accent">{icon}</span>
      <div className="min-w-0">
        <p className="text-ig-label text-ig-fg-muted">{label}</p>
        <p className={`truncate text-ig-body-sm font-semibold ${link ? 'text-ig-accent' : 'text-ig-fg-strong'}`}>{value}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-ig-border-subtle bg-ig-panel/45 p-3">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tabular-nums text-ig-fg-strong">{value}</p>
    </div>
  );
}
