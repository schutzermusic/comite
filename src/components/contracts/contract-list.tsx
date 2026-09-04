'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HudBadge, HudPanel, HudProgressBar, HudStatusPill, HudTable, type HudTableColumn } from '@/components/hud';
import type { ContractGovernanceRecord } from '@/components/contracts/contract-governance-data';
import { formatCurrencyCompact } from '@/components/contracts/contract-governance-data';
import type { TrustedContract } from '@/lib/contracts/trust/read-model';
import { officialCurrencyCompact } from '@/lib/contracts/trust/format';
import { hasOfficialValue, ratioTrusted } from '@/lib/contracts/trust/trusted';
import { missingDocuments as trustedMissingDocs } from '@/lib/contracts/trust/signals';
import { DataClassBadge } from '@/components/contracts/cockpit/PortfolioScope';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertTriangle,
  FileSearch,
  Building2,
  CalendarClock,
  Download,
  Eye,
  FileText,
  MoreVertical,
  ShieldCheck,
  Trash2,
  Workflow,
} from 'lucide-react';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

interface ContractListProps {
  /** Contratos confiáveis por id — fonte de todo valor monetário e operacional. */
  trustedById?: Map<string, TrustedContract>;
  records: ContractGovernanceRecord[];
  selectedRecordId?: string | null;
  onSelectRecord?: (record: ContractGovernanceRecord) => void;
  onViewContract?: (record: ContractGovernanceRecord) => void;
  onDownloadContract?: (record: ContractGovernanceRecord) => void;
  onDeleteLinkedProject?: (record: ContractGovernanceRecord) => void;
  onDeleteContract?: (record: ContractGovernanceRecord) => void;
  canDeleteLinkedProject?: boolean;
  canDeleteContract?: boolean;
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

/*
  `aiLabel`/`aiVariant` foram removidos.

  Mapeavam `mock_pending` → "IA mock pendente" e `mock_ready` → "Prévia mock"
  para um chip que a Fase 0 já havia tirado da tabela. Eram rótulos mortos
  descrevendo um estado simulado, esperando alguém voltar a renderizá-los.
*/

export function ContractList({
  records,
  trustedById,
  selectedRecordId,
  onSelectRecord,
  onViewContract,
  onDownloadContract,
  onDeleteLinkedProject,
  onDeleteContract,
  canDeleteLinkedProject = false,
  canDeleteContract = false,
}: ContractListProps) {
  const columns: HudTableColumn<ContractGovernanceRecord>[] = [
    {
      key: 'contract',
      header: 'Contrato',
      width: '320px',
      cell: (record) => {
        const isCritical = record.contract.riskClassification === 'high' || record.renewalStatus === 'expired';
        const isExpiring = record.renewalStatus === 'critical';
        const statusLabel = 
          record.contract.status === 'negotiation' ? 'Negociação'
          : record.contract.status === 'legal_review' ? 'Revisão Jurídica'
          : record.contract.status === 'commercial_review' ? 'Revisão Comercial'
          : record.contract.status === 'signed' ? 'Assinado'
          : record.contract.status === 'active' ? 'Ativo'
          : record.contract.status === 'expired' ? 'Expirado'
          : record.contract.status === 'closed' ? 'Encerrado'
          : record.contract.status === 'cancelled' ? 'Cancelado'
          : record.contract.status;

        const statusVariant =
          record.contract.status === 'active' || record.contract.status === 'signed' ? 'active'
          : record.contract.status === 'expired' || record.contract.status === 'cancelled' ? 'critical'
          : 'warning';

        return (
          <div className="flex min-w-[280px] items-start gap-3">
            <div className={`ig-icon-jewel mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center ${isCritical ? 'text-ig-danger border-ig-danger/30' : isExpiring ? 'text-ig-warning border-ig-warning/30' : 'text-ig-accent border-ig-accent/30'}`}>
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <HudBadge variant="outline" size="sm">{record.code}</HudBadge>
                <HudBadge variant={record.contractType.includes('Aditivo') ? 'warning' : 'subtle'} size="sm">
                  {record.contractType}
                </HudBadge>
                <HudStatusPill variant={statusVariant} size="sm">
                  {statusLabel}
                </HudStatusPill>
              </div>
              <p className="mt-1 truncate text-ig-body-sm font-semibold text-ig-fg-strong">
                {record.contract.name}
              </p>
              <p className="truncate text-ig-caption text-ig-fg-muted">
                {(() => {
                  const t = trustedById?.get(record.contract.id);
                  return (
                    <span className="flex items-center gap-1.5">
                      {t && <DataClassBadge dataClass={t.dataClass} />}
                      {t && hasOfficialValue(t.contractType) ? t.contractType.value : '—'}
                    </span>
                  );
                })()}
              </p>
            </div>
          </div>
        );
      },
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
              <span className="inline-flex items-center gap-1 truncate text-ig-caption font-medium text-ig-warning">
                <AlertTriangle className="h-3 w-3" />
                Projeto não vinculado
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'value',
      header: 'Exposição',
      width: '210px',
      cell: (record) => {
        // Valores confiáveis; "—" enquanto o batch não chegou ou sem apuração.
        const t = trustedById?.get(record.contract.id);
        const exec = t ? ratioTrusted(t.billedValue, t.totalValue, 'faturado sobre total', ['contracts', 'contract_billing_events']) : null;
        const pct = exec && hasOfficialValue(exec) ? Math.round(exec.value * 100) : null;
        const noBilling = Boolean(t && hasOfficialValue(t.billingEvents) && t.billingEvents.value.length === 0);
        const money = (v: Parameters<typeof officialCurrencyCompact>[0] | undefined) => (v ? officialCurrencyCompact(v) : '—');
        return (
          <div className="min-w-[180px] space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ig-caption text-ig-fg-muted">Total</span>
              <span className="ig-tabular text-ig-body-sm font-semibold text-ig-fg-strong">
                {money(t?.totalValue)}
              </span>
            </div>
            <HudProgressBar
              value={pct ?? 0}
              size="sm"
              showLabel={false}
              variant={pct === null ? 'default' : 'success'}
            />
            <div className="flex justify-between gap-3 text-ig-caption text-ig-fg-muted">
              <span>Faturado {money(t?.billedValue)}</span>
              {noBilling ? (
                <span className="text-ig-warning font-semibold">Sem evento registrado</span>
              ) : (
                <span>Saldo {money(t?.remainingValue)}</span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: 'renewal',
      header: 'Renovação',
      width: '150px',
      cell: (record) => {
        const isExpired = record.renewalStatus === 'expired';
        const isExpiringSoon = record.renewalStatus === 'critical';
        return (
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
            <p className={`text-ig-caption ${isExpired ? 'text-ig-danger font-semibold' : isExpiringSoon ? 'text-ig-warning font-semibold' : 'text-ig-fg-muted'}`}>
              {record.daysUntilExpiration === null
                ? 'Prazo não informado'
                : record.daysUntilExpiration < 0
                  ? `${Math.abs(record.daysUntilExpiration)}d vencido`
                  : `${record.daysUntilExpiration}d restantes`}
            </p>
          </div>
        );
      },
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
          {/* "riskScore NN/100" saiu: vinha de hash(id+nome). A classificação
              real (coluna `risk_level`) já está no pill acima. */}
        </div>
      ),
    },
    {
      key: 'ai',
      // Descreve o que a coluna mostra — leituras e documentos —, não o motor.
      header: 'Leitura / Docs',
      width: '190px',
      cell: (record) => {
        /* O chip de estado de IA e a "confiança NN%" saíram: `aiStatus` e
           `confidenceScore` vinham do enricher e rotulavam contratos sobre os
           quais nenhuma análise foi solicitada. Restam as análises REAIS e os
           documentos faltantes apurados. */
        const t = trustedById?.get(record.contract.id);
        const docs = t ? trustedMissingDocs(t) : null;
        const faltantes = docs && hasOfficialValue(docs) ? docs.value.length : null;
        const analises = t && hasOfficialValue(t.aiAnalyses) ? t.aiAnalyses.value.length : null;
        return (
          <div className="min-w-[160px] space-y-1.5">
            <div className="flex items-center gap-1.5 text-ig-caption text-ig-fg-muted">
              <FileSearch className="h-3.5 w-3.5" />
              {analises === null ? 'Leituras —' : `${analises} leitura(s)`}
            </div>
            <div className="flex items-center gap-1.5 text-ig-caption">
              {faltantes === null ? (
                <span className="text-ig-fg-muted">Documentos —</span>
              ) : faltantes > 0 ? (
                <span className="flex items-center gap-1 text-ig-warning font-semibold">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  {faltantes} docs faltantes
                </span>
              ) : (
                <span className="flex items-center gap-1 text-ig-success">
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  Docs completos
                </span>
              )}
            </div>
          </div>
        );
      },
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
              {/*
                "Solicitar análise IA" saiu: era um item de menu SEM `onClick`
                — clicar não fazia absolutamente nada. Além de quebrado, era
                justamente a afordância manual de IA que o produto deixou de
                oferecer. A leitura documental real é acionada no dossiê, por
                documento, onde há evidência para revisar.
              */}
              {canDeleteLinkedProject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-ig-danger focus:text-ig-danger"
                    disabled={!record.project}
                    onClick={() => onDeleteLinkedProject?.(record)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {record.project ? 'Excluir projeto' : 'Sem projeto vinculado'}
                  </DropdownMenuItem>
                </>
              )}
              {canDeleteContract && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-ig-danger focus:text-ig-danger"
                    onClick={() => onDeleteContract?.(record)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir contrato
                  </DropdownMenuItem>
                </>
              )}
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
