'use client';

import { Contract } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { cn } from "@/lib/utils";

interface ContractListProps {
  contracts: Contract[];
  selectedContractId?: string | null;
  onSelectContract?: (contract: Contract) => void;
  onViewContract?: (contract: Contract) => void;
  onDownloadContract?: (contract: Contract) => void;
}

export function ContractList({ 
  contracts, 
  selectedContractId,
  onSelectContract,
  onViewContract, 
  onDownloadContract 
}: ContractListProps) {
  const getRiskVariant = (classification: Contract['riskClassification']) => {
    const variants: Record<string, string> = {
      'high': 'critical',
      'medium': 'warning',
      'low': 'active',
    };
    return variants[classification] || 'neutral';
  };

  const getStatusVariant = (status: Contract['status']) => {
    const variants: Record<string, string> = {
      'expired': 'critical',
      'expiring_soon': 'warning',
      'active': 'active',
    };
    return variants[status] || 'neutral';
  };

  const getDaysUntilExpiration = (expirationDate?: Date) => {
    if (!expirationDate) return null;
    const days = differenceInDays(new Date(expirationDate), new Date());
    return days;
  };

  return (
    <div className="overflow-x-auto p-4">
      <Table>
        <TableHeader className="hud-surface">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Contrato</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Fornecedor</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Valor</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Expiração</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Risco</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Status</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contracts.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 hud-text-muted" />
                <p className="hud-text-secondary">Nenhum contrato registrado</p>
                <p className="text-sm hud-text-muted">Faça upload de contratos para começar</p>
              </TableCell>
            </TableRow>
          ) : (
            contracts.map((contract) => {
              const daysUntilExpiration = getDaysUntilExpiration(contract.expirationDate);
              const isSelected = selectedContractId === contract.id;
              
              return (
                <TableRow 
                  key={contract.id} 
                  className={cn(
                    "transition-colors cursor-pointer hud-table-row",
                    isSelected
                      ? "hud-table-row-selected"
                      : "hud-table-row-hover"
                  )}
                  onClick={() => onSelectContract?.(contract)}
                  onDoubleClick={() => onViewContract?.(contract)}
                >
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <FileText className="w-5 h-5 hud-accent-icon mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-semibold hud-text">{contract.name}</p>
                        <p className="text-[11px] hud-text-tertiary">
                          Upload: {format(new Date(contract.uploadedAt), 'dd/MM/yyyy', { locale: pt })}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm hud-text">{contract.vendorOrParty}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-base hud-text font-semibold">
                      <DollarSign className="w-4 h-4 hud-accent-success" />
                      {new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: contract.currency 
                      }).format(contract.value)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-sm hud-text">
                        <Calendar className="w-4 h-4 hud-accent-icon" />
                        {contract.expirationDate 
                          ? format(new Date(contract.expirationDate), 'dd/MM/yyyy', { locale: pt })
                          : 'N/A'}
                      </div>
                      {daysUntilExpiration !== null && (
                        <p className={`text-xs ${
                          daysUntilExpiration < 0 ? 'hud-accent-danger' :
                          daysUntilExpiration < 30 ? 'hud-accent-warning' :
                          'hud-text-tertiary'
                        }`}>
                          {daysUntilExpiration < 0 
                            ? `Expirado há ${Math.abs(daysUntilExpiration)} dias`
                            : `${daysUntilExpiration} dias restantes`
                          }
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={getRiskVariant(contract.riskClassification)} className="text-[11px]">
                      {contract.riskClassification === 'high' ? 'Alto' :
                        contract.riskClassification === 'medium' ? 'Médio' : 'Baixo'}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={getStatusVariant(contract.status)} className="text-[11px]">
                      {contract.status === 'expired' ? 'Expirado' :
                        contract.status === 'expiring_soon' ? 'Expirando' : 'Ativo'}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="hud-text-secondary hud-action-btn rounded-full">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 hud-dropdown-surface">
                        <DropdownMenuItem onClick={() => onViewContract?.(contract)}>
                          <Eye className="w-4 h-4 mr-2" />
                          Visualizar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDownloadContract?.(contract)}>
                          <Download className="w-4 h-4 mr-2" />
                          Download
                        </DropdownMenuItem>
                        
                        {contract.riskClassification === 'high' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="hud-accent-danger">
                              <AlertTriangle className="w-4 h-4 mr-2" />
                              Ver Riscos Associados
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
