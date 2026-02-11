'use client';

import { useState } from "react";
import { AgendaBacklogItem } from "@/lib/types";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  MoreVertical, 
  Eye, 
  Edit, 
  Archive, 
  Trash2,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle
} from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

// Funções de tradução
const translateStatus = (status: string): string => {
  const translations: Record<string, string> = {
    'draft': 'Rascunho',
    'under_review': 'Em Revisão',
    'approved': 'Aprovado',
    'archived': 'Arquivado',
  };
  return translations[status] || status;
};

const translatePriority = (priority: string): string => {
  const translations: Record<string, string> = {
    'low': 'Baixa',
    'medium': 'Média',
    'high': 'Alta',
    'critical': 'Crítica',
  };
  return translations[priority] || priority;
};

const translateType = (type: string): string => {
  const translations: Record<string, string> = {
    'Financial': 'Financeiro',
    'Legal': 'Legal',
    'Operational': 'Operacional',
    'Risk': 'Risco',
    'Compliance': 'Conformidade',
  };
  return translations[type] || type;
};

interface AgendaBacklogListProps {
  items: AgendaBacklogItem[];
  onViewItem?: (item: AgendaBacklogItem) => void;
  onEditItem?: (item: AgendaBacklogItem) => void;
  onArchiveItem?: (itemId: string) => void;
  onDeleteItem?: (itemId: string) => void;
  onChangeStatus?: (itemId: string, newStatus: AgendaBacklogItem['status']) => void;
}

export function AgendaBacklogList({ 
  items, 
  onViewItem,
  onEditItem,
  onArchiveItem,
  onDeleteItem,
  onChangeStatus
}: AgendaBacklogListProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

  const getTypeVariant = (type: string) => {
    const variants: Record<string, string> = {
      'Financial': 'info',
      'Legal': 'neutral',
      'Operational': 'active',
      'Risk': 'critical',
      'Compliance': 'warning',
    };
    return variants[type] || 'neutral';
  };

  const getStatusIcon = (status: AgendaBacklogItem['status']) => {
    switch (status) {
      case 'draft':
        return <FileText className="w-4 h-4" />;
      case 'under_review':
        return <Clock className="w-4 h-4" />;
      case 'approved':
        return <CheckCircle className="w-4 h-4" />;
      case 'archived':
        return <Archive className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  const handleDeleteConfirm = () => {
    if (itemToDelete && onDeleteItem) {
      onDeleteItem(itemToDelete);
      setItemToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <>
      <div className="overflow-x-auto p-4">
        <Table>
          <TableHeader className="bg-[rgba(255,255,255,0.02)]">
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Título</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Tipo</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Status</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Prioridade</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Comitê</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide">Criado em</TableHead>
              <TableHead className="font-semibold text-[rgba(255,255,255,0.75)] uppercase text-[11px] tracking-wide text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <FileText className="w-12 h-12 mx-auto mb-3 text-[rgba(255,255,255,0.25)]" />
                  <p className="text-[rgba(255,255,255,0.75)]">Nenhum item encontrado</p>
                  <p className="text-sm text-[rgba(255,255,255,0.55)]">Crie um novo item de agenda para começar</p>
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow 
                  key={item.id} 
                  className="hover:bg-[rgba(0,255,180,0.04)] transition-colors cursor-pointer border-b border-[rgba(255,255,255,0.04)]"
                  onClick={() => onViewItem?.(item)}
                >
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <div className="mt-1 text-[#00C8FF]">
                        {getStatusIcon(item.status)}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{item.title}</p>
                        <p className="text-xs text-[rgba(255,255,255,0.65)] line-clamp-1">{item.description}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill 
                      variant={getTypeVariant(item.type)}
                      className="text-[11px]"
                    >
                      {translateType(item.type)}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <StatusPill variant={
                      item.status === 'approved' ? 'completed' :
                      item.status === 'under_review' ? 'warning' :
                      item.status === 'draft' ? 'neutral' :
                      'at_risk'
                    }>
                      {translateStatus(item.status)}
                    </StatusPill>
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={item.priority} />
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-[rgba(255,255,255,0.75)]">
                      {item.committeeName || 'N/A'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm text-[rgba(255,255,255,0.75)]">
                      {format(new Date(item.createdAt), 'dd/MM/yyyy', { locale: pt })}
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
                        <DropdownMenuItem onClick={() => onViewItem?.(item)}>
                          <Eye className="w-4 h-4 mr-2" />
                          Visualizar
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onEditItem?.(item)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Editar
                        </DropdownMenuItem>
                        
                        <DropdownMenuSeparator />
                        
                        {item.status !== 'approved' && (
                          <DropdownMenuItem onClick={() => onChangeStatus?.(item.id, 'approved')}>
                            <CheckCircle className="w-4 h-4 mr-2 text-[#00FFB4]" />
                            Aprovar
                          </DropdownMenuItem>
                        )}
                        
                        {item.status !== 'archived' && (
                          <DropdownMenuItem onClick={() => onArchiveItem?.(item.id)}>
                            <Archive className="w-4 h-4 mr-2" />
                            Arquivar
                          </DropdownMenuItem>
                        )}
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuItem 
                          onClick={() => {
                            setItemToDelete(item.id);
                            setDeleteDialogOpen(true);
                          }}
                          className="text-[#FF5860]"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O item será permanentemente excluído do sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
