'use client';

import { useState } from "react";
import { AgendaBacklogItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, Upload } from "lucide-react";
import { HudInput, hudInputBase } from "@/components/ui/hud-input";
import { PrimaryCTA } from "../ui/primary-cta";
import { SecondaryButton } from "../ui/secondary-button";
import { cn } from "@/lib/utils";

interface AgendaBacklogFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: AgendaBacklogItem;
  onSubmit: (data: Partial<AgendaBacklogItem>) => void;
  committees?: { id: string; name: string }[];
}

export function AgendaBacklogForm({ 
  open, 
  onOpenChange, 
  item,
  onSubmit,
  committees = []
}: AgendaBacklogFormProps) {
  const [formData, setFormData] = useState<Partial<AgendaBacklogItem>>(
    item || {
      title: '',
      description: '',
      type: 'Operational',
      priority: 'medium',
      status: 'draft',
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    onOpenChange(false);
  };

  const updateField = (field: keyof AgendaBacklogItem, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.10)]">
        <DialogHeader>
          <DialogTitle className="text-lg text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#00C8FF]" />
            {item ? 'Editar Item de Agenda' : 'Novo Item de Agenda'}
          </DialogTitle>
          <DialogDescription className="text-[rgba(255,255,255,0.65)]">
            {item ? 'Atualize as informações do item' : 'Preencha as informações do novo item de agenda'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-[rgba(255,255,255,0.85)]">Título *</Label>
              <HudInput
                id="title"
                value={formData.title}
                onChange={(e) => updateField('title', e.target.value)}
                placeholder="Ex: Aprovação de novo projeto"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="committee" className="text-[rgba(255,255,255,0.85)]">Comitê</Label>
              <Select 
                value={formData.committeeId} 
                onValueChange={(value) => updateField('committeeId', value)}
              >
                <SelectTrigger id="committee" className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
                  <SelectValue placeholder="Selecione um comitê" />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                  {committees.map(committee => (
                    <SelectItem key={committee.id} value={committee.id}>
                      {committee.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-[rgba(255,255,255,0.85)]">Descrição *</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Descreva os detalhes do item de agenda..."
              rows={4}
              required
              className={cn(hudInputBase, "min-h-[120px]")}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type" className="text-[rgba(255,255,255,0.85)]">Tipo *</Label>
              <Select 
                value={formData.type} 
                onValueChange={(value) => updateField('type', value)}
              >
                <SelectTrigger id="type" className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectItem value="Financial">Financeiro</SelectItem>
                  <SelectItem value="Legal">Legal</SelectItem>
                  <SelectItem value="Operational">Operacional</SelectItem>
                  <SelectItem value="Risk">Risco</SelectItem>
                  <SelectItem value="Compliance">Conformidade</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="priority" className="text-[rgba(255,255,255,0.85)]">Prioridade *</Label>
              <Select 
                value={formData.priority} 
                onValueChange={(value) => updateField('priority', value)}
              >
                <SelectTrigger id="priority" className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="critical">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4 pt-2 border-t border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center gap-2 text-xs font-semibold text-[rgba(255,255,255,0.75)] uppercase tracking-wide">
              <FileText className="w-4 h-4 text-[#00C8FF]" />
              Parecer Jurídico (Opcional)
            </div>

            <div className="space-y-2">
              <Label htmlFor="legalOpinion" className="text-[rgba(255,255,255,0.85)]">Texto do Parecer</Label>
              <Textarea
                id="legalOpinion"
                value={formData.legalOpinionText}
                onChange={(e) => updateField('legalOpinionText', e.target.value)}
                placeholder="Digite o parecer jurídico..."
                rows={3}
                className={cn(hudInputBase, "min-h-[100px]")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="legalAttachment" className="text-[rgba(255,255,255,0.85)]">Anexo do Parecer</Label>
              <div className="flex items-center gap-2">
                <input
                  id="legalAttachment"
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className={cn(hudInputBase, "flex-1 file:text-white file:bg-transparent file:border-0 file:px-2 file:py-1")}
                />
                <Button type="button" variant="outline" size="sm" className="border-[rgba(255,255,255,0.20)] text-[rgba(255,255,255,0.85)] hover:border-[rgba(0,200,255,0.35)] hover:bg-[rgba(0,200,255,0.10)]">
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </Button>
              </div>
              <p className="text-xs text-[rgba(255,255,255,0.55)]">
                Formatos aceitos: PDF, DOC, DOCX (máx. 10MB)
              </p>
            </div>
          </div>

          <DialogFooter className="flex justify-end gap-3 pt-2">
            <SecondaryButton type="button" onClick={() => onOpenChange(false)}>
              Cancelar
            </SecondaryButton>
            <PrimaryCTA type="submit">
              {item ? 'Salvar Alterações' : 'Criar Item'}
            </PrimaryCTA>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
