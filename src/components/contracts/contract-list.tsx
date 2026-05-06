'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HudBadge, HudPanel, HudProgressBar, HudStatusPill, HudTable, type HudTableColumn } from '@/components/hud';
import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { formatCurrencyCompact } from '@/components/contracts/contract-governance-data';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertTriangle,
  BrainCircuit,
  Building2,
  CalendarClock,
  Download,
  Eye,
  FileText,
  MoreVertical,
  ShieldCheck,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface ContractListProps {
  records: ContractGovernanceRecord[];
  selectedRecordId?: string | null;
  onSelectRecord?: (record: ContractGovernanceRecord) => void;
  onViewContract?: (record: ContractGovernanceRecord) => void;
  onDownloadContract?: (record: ContractGovernanceRecord) => void;
}

const riskVariant = {
  high: 'critical',
  medium: 'warning',
  low: 'active',
} as const;

const riskLabel = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
} as const;

const renewalVariant = {
  expired: 'critical',
  critical: 'critical',
  attention: 'warning',
  planned: 'info',
  stable: 'active',
} as const;

const renewalLabel = {
  expired: 'Expirado',
  critical: 'A vencer',
  attention: 'Renovação',
  planned: 'Planejado',
  stable: 'Estável',
} as const;

const aiLabel = {
  mock_pending: 'IA mock pendente',
  mock_ready: 'Prévia mock',
  manual_review: 'Revisão manual',
} as const;

const aiVariant = {
  mock_pending: 'neutral',
  mock_ready: 'info',
  manual_review: 'warning',
} as const;

export function ContractList({
  records,
  selectedRecordId,
  onSelectRecord,
  onViewContract,
  onDownloadContract,
}: ContractListProps) {
  const columns: HudTableColumn<ContractGovernanceRecord>[] = [
    {
      key: 'contract',
      header: 'Contrato',
      width: '300px',
      cell: (record) => (
        <div className="flex min-w-[260px] items-start gap-3">
          <div className="ig-icon-jewel mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center text-ig-accent">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <HudBadge variant="outline" size="sm">{record.code}</HudBadge>
              <HudBadge variant={record.contractType.includes('Aditivo') ? 'warning' : 'subtle'} size="sm">
                {record.contractType}
              </HudBadge>
            </div>
            <p className="mt-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
              {record.contract.name}
            </p>
            <p className="truncate text-ig-caption text-ig-fg-muted">
              Owner: {record.owner}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'relations',
      header: 'Vínculos',
      width: '260px',
      cell: (record) => (
        <div className="min-w-[220px] space-y-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" />
            <span className="truncate text-ig-body-sm font-medium text-ig-fg-strong">
              {record.companyName}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Workflow className="h-3.5 w-3.5 shrink-0 text-ig-fg-subtle" />
            {record.project ? (
              <Link
                href={`/projetos/${record.project.id}`}
                onClick={(event) => event.stopPropagation()}
                className="truncate text-ig-caption font-medium text-ig-accent transition-colors hover:text-ig-accent-strong"
              >
                {record.projectReference}
              </Link>
            ) : (
              <span className="truncate text-ig-caption text-ig-fg-muted">{record.projectReference}</span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Exposição',
      width: '210px',
      cell: (record) => (
        <div className="min-w-[180px] space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-ig-caption text-ig-fg-muted">Total</span>
            <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
              {formatCurrencyCompact(record.totalValue, record.contract.currency)}
            </span>
          </div>
          <HudProgressBar
            value={record.totalValue ? Math.round((record.billedValue / record.totalValue) * 100) : 0}
            size="sm"
            variant={record.financialStatus === 'blocked' ? 'danger' : record.financialStatus === 'attention' ? 'warning' : 'success'}
          />
          <div className="flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
            <span>Faturado {formatCurrencyCompact(record.billedValue, record.contract.currency)}</span>
            <span>Saldo {formatCurrencyCompact(record.remainingValue, record.contract.currency)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'renewal',
      header: 'Renovação',
      width: '150px',
      cell: (record) => (
        <div className="space-y-1">
          <HudStatusPill variant={renewalVariant[record.renewalStatus]} size="sm">
            {renewalLabel[record.renewalStatus]}
          </HudStatusPill>
          <div className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
            <CalendarClock className="h-3.5 w-3.5" />
            {record.contract.expirationDate
              ? format(new Date(record.contract.expirationDate), 'dd/MM/yyyy', { locale: pt })
              : 'Sem data'}
          </div>
          <p className="text-ig-caption text-ig-fg-muted">
            {record.daysUntilExpiration === null
              ? 'Prazo não informado'
              : record.daysUntilExpiration < 0
                ? `${Math.abs(record.daysUntilExpiration)}d vencido`
                : `${record.daysUntilExpiration}d restantes`}
          </p>
        </div>
      ),
    },
    {
      key: 'risk',
      header: 'Risco',
      width: '130px',
      cell: (record) => (
        <div className="space-y-2">
          <HudStatusPill variant={riskVariant[record.contract.riskClassification]} size="sm" pulse={record.contract.riskClassification === 'high'}>
            Risco {riskLabel[record.contract.riskClassification]}
          </HudStatusPill>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-ig-fg-subtle" />
            <span className="ig-tabular text-ig-caption font-semibold text-ig-fg-strong">
              {record.riskScore}/100
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'ai',
      header: 'IA / Docs',
      width: '180px',
      cell: (record) => (
        <div className="min-w-[150px] space-y-1.5">
          <HudBadge variant={aiVariant[record.aiStatus]} size="sm" dot>
            {aiLabel[record.aiStatus]}
          </HudBadge>
          <div className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
            <BrainCircuit className="h-3.5 w-3.5" />
            Confiança mock {record.confidenceScore}%
          </div>
          <div className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
            <AlertTriangle className="h-3.5 w-3.5" />
            {record.missingDocuments.length} pendência(s)
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Ações',
      width: '80px',
      align: 'right',
      cell: (record) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-full text-ig-fg-muted hover:text-ig-fg-strong">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 hud-dropdown-surface">
              <DropdownMenuItem onClick={() => onViewContract?.(record)}>
                <Eye className="mr-2 h-4 w-4" />
                Abrir dossiê
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownloadContract?.(record)}>
                <Download className="mr-2 h-4 w-4" />
                Baixar documento
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <BrainCircuit className="mr-2 h-4 w-4" />
                Solicitar análise IA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <HudPanel elevation={2} noPadding interactive={false} serial="CTR-GOV-001" watermark="CONTRACT CONTROL ROOM">
      <HudTable
        columns={columns}
        data={records}
        keyExtractor={(record) => record.contract.id}
        onRowClick={onSelectRecord}
        selectedRowId={selectedRecordId ?? null}
        compact
        className="p-3"
        emptyState={
          <div className="py-14 text-center">
            <FileText className="mx-auto mb-3 h-11 w-11 text-ig-fg-muted" />
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">Nenhum contrato encontrado</p>
            <p className="text-ig-body-sm text-ig-fg-muted">Ajuste os filtros ou inicie um novo fluxo de contrato.</p>
          </div>
        }
      />
    </HudPanel>
  );
}
