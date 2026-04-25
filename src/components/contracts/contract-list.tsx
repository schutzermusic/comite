'use client';

import type { Contract } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { HudStatusPill, type HudStatusPillVariant } from "@/components/hud/HudStatusPill";
import { HudTable, type HudTableColumn } from "@/components/hud/HudTable";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { 
  MoreVertical, 
  Eye, 
  Download, 
  FileText,
  Calendar,
  DollarSign,
  AlertTriangle
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { pt } from "date-fns/locale";

interface ContractListProps {
  contracts: Contract[];
  selectedContractId?: string | null;
  onSelectContract?: (contract: Contract) => void;
  onViewContract?: (contract: Contract) => void;
  onDownloadContract?: (contract: Contract) => void;
}

const riskVariants: Record<Contract['riskClassification'], HudStatusPillVariant> = {
  high: 'critical',
  medium: 'warning',
  low: 'active',
};

const riskLabels: Record<Contract['riskClassification'], string> = {
  high: 'Alto',
  medium: 'Médio',
  low: 'Baixo',
};

const statusVariants: Record<Contract['status'], HudStatusPillVariant> = {
  expired: 'critical',
  expiring_soon: 'warning',
  active: 'active',
};

const statusLabels: Record<Contract['status'], string> = {
  expired: 'Expirado',
  expiring_soon: 'Expirando',
  active: 'Ativo',
};

function getDaysUntilExpiration(expirationDate?: Date) {
  if (!expirationDate) return null;
  return differenceInDays(new Date(expirationDate), new Date());
}

export function ContractList({ 
  contracts, 
  selectedContractId,
  onSelectContract,
  onViewContract, 
  onDownloadContract 
}: ContractListProps) {
  const columns: HudTableColumn<Contract>[] = [
    {
      key: 'name',
      header: 'Contrato',
      width: '280px',
      cell: (contract) => (
        <div className="flex min-w-[240px] items-start gap-2" onDoubleClick={() => onViewContract?.(contract)}>
          <FileText className="mt-0.5 h-5 w-5 flex-shrink-0 text-ig-accent" />
          <div>
            <p className="text-ig-body-sm font-semibold text-ig-fg-strong">{contract.name}</p>
            <p className="text-ig-caption text-ig-fg-muted">
              Upload: {format(new Date(contract.uploadedAt), 'dd/MM/yyyy', { locale: pt })}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'vendorOrParty',
      header: 'Fornecedor',
      cell: (contract) => (
        <span className="text-ig-body-sm text-ig-fg-strong">{contract.vendorOrParty}</span>
      ),
    },
    {
      key: 'value',
      header: 'Valor',
      width: '160px',
      cell: (contract) => (
        <div className="flex items-center gap-1 text-ig-body-sm font-semibold text-ig-fg-strong">
          <DollarSign className="h-4 w-4 text-ig-success" />
          <span className="ig-tabular">
            {new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: contract.currency,
            }).format(contract.value)}
          </span>
        </div>
      ),
    },
    {
      key: 'expirationDate',
      header: 'Expiração',
      width: '150px',
      cell: (contract) => {
        const daysUntilExpiration = getDaysUntilExpiration(contract.expirationDate);

        return (
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-ig-body-sm text-ig-fg-strong">
              <Calendar className="h-4 w-4 text-ig-accent" />
              {contract.expirationDate
                ? format(new Date(contract.expirationDate), 'dd/MM/yyyy', { locale: pt })
                : 'N/A'}
            </div>
            {daysUntilExpiration !== null && (
              <p
                className={
                  daysUntilExpiration < 0
                    ? 'text-ig-caption text-ig-danger'
                    : daysUntilExpiration < 30
                      ? 'text-ig-caption text-ig-warning'
                      : 'text-ig-caption text-ig-fg-muted'
                }
              >
                {daysUntilExpiration < 0
                  ? `Expirado há ${Math.abs(daysUntilExpiration)} dias`
                  : `${daysUntilExpiration} dias restantes`}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: 'riskClassification',
      header: 'Risco',
      width: '110px',
      cell: (contract) => (
        <HudStatusPill variant={riskVariants[contract.riskClassification]} size="sm">
          {riskLabels[contract.riskClassification]}
        </HudStatusPill>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      cell: (contract) => (
        <HudStatusPill variant={statusVariants[contract.status]} size="sm">
          {statusLabels[contract.status]}
        </HudStatusPill>
      ),
    },
    {
      key: 'actions',
      header: 'Ações',
      width: '88px',
      align: 'right',
      cell: (contract) => (
        <div onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="rounded-full text-ig-fg-muted hover:text-ig-fg-strong">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 hud-dropdown-surface">
              <DropdownMenuItem onClick={() => onViewContract?.(contract)}>
                <Eye className="mr-2 h-4 w-4" />
                Visualizar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDownloadContract?.(contract)}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </DropdownMenuItem>

              {contract.riskClassification === 'high' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-ig-danger">
                    <AlertTriangle className="mr-2 h-4 w-4" />
                    Ver Riscos Associados
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
    <HudTable
      columns={columns}
      data={contracts}
      keyExtractor={(contract) => contract.id}
      onRowClick={onSelectContract}
      selectedRowId={selectedContractId ?? null}
      className="p-4"
      emptyState={
        <div className="py-12 text-center">
          <FileText className="mx-auto mb-3 h-12 w-12 text-ig-fg-muted" />
          <p className="text-ig-body-sm text-ig-fg-strong">Nenhum contrato registrado</p>
          <p className="text-ig-body-sm text-ig-fg-muted">Faça upload de contratos para começar</p>
        </div>
      }
    />
  );
}
