'use client';

import { Risk } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { SeverityBadge } from "@/components/ui/severity-badge";
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
  Edit, 
  CheckCircle, 
  ShieldAlert,
  FileCheck,
  Briefcase,
  User
} from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

interface RiskListProps {
  risks: Risk[];
  onViewRisk?: (risk: Risk) => void;
  onEditRisk?: (risk: Risk) => void;
  onResolveRisk?: (riskId: string) => void;
}

export function RiskList({ risks, onViewRisk, onEditRisk, onResolveRisk }: RiskListProps) {
  const getCategoryVariant = (category: Risk['category']) => {
    const variants: Record<string, string> = {
      'Operational': 'info',
      'Financial': 'active',
      'Legal': 'neutral',
      'Contractual': 'warning',
      'Compliance': 'warning',
    };
    return variants[category] || 'neutral';
  };

  const getOriginIcon = (origin: Risk['origin']) => {
    switch (origin) {
      case 'contract':
        return <FileCheck className="w-4 h-4" />;
      case 'project':
        return <Briefcase className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="hud-surface">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Título</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Categoria</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Severidade</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide text-center">P×I</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Status</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Origem</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide">Criado em</TableHead>
            <TableHead className="font-semibold hud-label uppercase text-[11px] tracking-wide text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {risks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12">
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 hud-text-muted" />
                <p className="hud-text-secondary">Nenhum risco registrado</p>
                <p className="text-sm hud-text-muted">Adicione riscos para monitoramento</p>
              </TableCell>
            </TableRow>
          ) : (
            risks.map((risk) => (
              <TableRow 
                key={risk.id} 
                className="hud-table-row-hover transition-colors cursor-pointer hud-table-row"
                onClick={() => onViewRisk?.(risk)}
              >
                <TableCell>
                  <div>
                    <p className="font-semibold hud-text">{risk.title}</p>
                    <p className="text-xs hud-text-tertiary line-clamp-1">{risk.description}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill 
                    variant={getCategoryVariant(risk.category)}
                    className="text-[11px]"
                  >
                    {risk.category}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={risk.severity} score={risk.level} />
                </TableCell>
                <TableCell className="text-center">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full hud-surface-elevated border hud-surface-elevated hud-text text-sm font-medium">
                    <span>{risk.probability}</span>
                    <span className="hud-text-muted">×</span>
                    <span>{risk.impact}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill variant={risk.status === 'resolved' ? 'completed' : risk.status === 'mitigating' ? 'warning' : 'critical'}>
                    {risk.status}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm hud-text-secondary">
                    {getOriginIcon(risk.origin)}
                    <span className="capitalize">{risk.origin}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm hud-text-secondary">
                    {format(new Date(risk.createdAt), 'dd/MM/yyyy', { locale: pt })}
                  </span>
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="hud-text-secondary hud-action-btn rounded-full">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 hud-dropdown-surface" sideOffset={4}>
                      <DropdownMenuItem onClick={() => onViewRisk?.(risk)}>
                        <Eye className="w-4 h-4 mr-2" />
                        Visualizar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onEditRisk?.(risk)}>
                        <Edit className="w-4 h-4 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      
                      {risk.status === 'open' && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onResolveRisk?.(risk.id)} className="text-[#00FFB4]">
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Marcar como Resolvido
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
