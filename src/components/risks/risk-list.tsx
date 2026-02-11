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
        <TableHeader className="bg-[rgba(255,255,255,0.02)]">
          <TableRow className="hover:bg-transparent">
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Título</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Categoria</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Severidade</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide text-center">P×I</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Status</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Origem</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Criado em</TableHead>
            <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {risks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-12">
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.25)]" />
                <p className="text-[rgba(255,255,255,0.75)]">Nenhum risco registrado</p>
                <p className="text-sm text-[rgba(255,255,255,0.55)]">Adicione riscos para monitoramento</p>
              </TableCell>
            </TableRow>
          ) : (
            risks.map((risk) => (
              <TableRow 
                key={risk.id} 
                className="hover:bg-[rgba(0,255,180,0.04)] transition-colors cursor-pointer border-b border-[rgba(255,255,255,0.04)]"
                onClick={() => onViewRisk?.(risk)}
              >
                <TableCell>
                  <div>
                    <p className="font-semibold text-white">{risk.title}</p>
                    <p className="text-xs text-[rgba(255,255,255,0.65)] line-clamp-1">{risk.description}</p>
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
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.10)] text-[rgba(255,255,255,0.85)] text-sm font-medium">
                    <span>{risk.probability}</span>
                    <span className="text-[rgba(255,255,255,0.45)]">×</span>
                    <span>{risk.impact}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusPill variant={risk.status === 'resolved' ? 'completed' : risk.status === 'mitigating' ? 'warning' : 'critical'}>
                    {risk.status}
                  </StatusPill>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.75)]">
                    {getOriginIcon(risk.origin)}
                    <span className="capitalize">{risk.origin}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-[rgba(255,255,255,0.75)]">
                    {format(new Date(risk.createdAt), 'dd/MM/yyyy', { locale: pt })}
                  </span>
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-[rgba(255,255,255,0.75)] hover:text-white hover:bg-[rgba(0,200,255,0.12)] rounded-full">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)]">
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
