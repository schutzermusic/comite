'use client';

import { useState } from "react";
import { AgendaBacklogItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { pt } from "date-fns/locale";

interface ImportApprovedItemsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approvedItems: AgendaBacklogItem[];
  onImport: (selectedItemIds: string[]) => void;
}

export function ImportApprovedItemsModal({ 
  open, 
  onOpenChange,
  approvedItems,
  onImport
}: ImportApprovedItemsModalProps) {
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  const handleToggleItem = (itemId: string) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleImport = () => {
    onImport(Array.from(selectedItems));
    setSelectedItems(new Set());
    onOpenChange(false);
  };

  const handleSelectAll = () => {
    if (selectedItems.size === approvedItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(approvedItems.map(item => item.id)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-emerald-600" />
            Importar Itens Aprovados
          </DialogTitle>
          <DialogDescription>
            Selecione os itens de agenda aprovados para incluir na reunião
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Header Actions */}
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-md border border-slate-200">
            <div className="text-sm text-slate-600">
              {selectedItems.size} de {approvedItems.length} selecionados
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSelectAll}
            >
              {selectedItems.size === approvedItems.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
            </Button>
          </div>

          {/* Items List */}
          <ScrollArea className="h-[400px] pr-4">
            {approvedItems.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <AlertCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="font-medium">Nenhum item aprovado disponível</p>
                <p className="text-sm">Aprove itens de agenda primeiro para importá-los</p>
              </div>
            ) : (
              <div className="space-y-3">
                {approvedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition-all ${
                      selectedItems.has(item.id)
                        ? 'border-emerald-300 bg-emerald-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                    onClick={() => handleToggleItem(item.id)}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedItems.has(item.id)}
                        onCheckedChange={() => handleToggleItem(item.id)}
                        className="mt-1"
                      />
                      
                      <div className="flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-900 mb-1">{item.title}</h4>
                            <p className="text-sm text-slate-600 line-clamp-2">{item.description}</p>
                          </div>
                          <Badge 
                            variant="outline" 
                            className="bg-emerald-100 text-emerald-700 border-emerald-300 text-xs"
                          >
                            Aprovado
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <Badge variant="outline" className="text-xs">
                            {item.type}
                          </Badge>
                          {item.committeeName && (
                            <span>{item.committeeName}</span>
                          )}
                          <span>
                            Criado em {format(new Date(item.createdAt), 'dd/MM/yyyy', { locale: pt })}
                          </span>
                        </div>

                        {item.legalOpinionText && (
                          <div className="flex items-center gap-1 text-xs text-blue-600">
                            <FileText className="w-3 h-3" />
                            <span>Com parecer jurídico</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={selectedItems.size === 0}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Importar {selectedItems.size > 0 && `(${selectedItems.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

