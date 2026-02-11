'use client';

import { HudInput } from "@/components/ui/hud-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, Search } from "lucide-react";

interface AgendaBacklogFiltersProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  priorityFilter: string;
  onPriorityChange: (value: string) => void;
  typeFilter: string;
  onTypeChange: (value: string) => void;
  committeeFilter: string;
  onCommitteeChange: (value: string) => void;
  committees?: { id: string; name: string }[];
}

export function AgendaBacklogFilters({
  searchTerm,
  onSearchChange,
  statusFilter,
  onStatusChange,
  priorityFilter,
  onPriorityChange,
  typeFilter,
  onTypeChange,
  committeeFilter,
  onCommitteeChange,
  committees = []
}: AgendaBacklogFiltersProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold text-[rgba(255,255,255,0.75)] uppercase tracking-wide">
        <Filter className="w-4 h-4 text-[#00C8FF]" />
        Filtros
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <div className="relative lg:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgba(255,255,255,0.45)]" />
          <HudInput
            placeholder="Buscar por título ou descrição..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
            <SelectItem value="all">Todos Status</SelectItem>
            <SelectItem value="draft">Rascunho</SelectItem>
            <SelectItem value="under_review">Em Revisão</SelectItem>
            <SelectItem value="approved">Aprovado</SelectItem>
            <SelectItem value="archived">Arquivado</SelectItem>
          </SelectContent>
        </Select>

        {/* Priority Filter */}
        <Select value={priorityFilter} onValueChange={onPriorityChange}>
          <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
            <SelectItem value="all">Todas Prioridades</SelectItem>
            <SelectItem value="low">Baixa</SelectItem>
            <SelectItem value="medium">Média</SelectItem>
            <SelectItem value="high">Alta</SelectItem>
            <SelectItem value="critical">Crítica</SelectItem>
          </SelectContent>
        </Select>

        {/* Type Filter */}
        <Select value={typeFilter} onValueChange={onTypeChange}>
          <SelectTrigger className="bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
            <SelectItem value="all">Todos Tipos</SelectItem>
            <SelectItem value="Financial">Financeiro</SelectItem>
            <SelectItem value="Legal">Legal</SelectItem>
            <SelectItem value="Operational">Operacional</SelectItem>
            <SelectItem value="Risk">Risco</SelectItem>
            <SelectItem value="Compliance">Conformidade</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Committee Filter (if applicable) */}
      {committees.length > 0 && (
        <Select value={committeeFilter} onValueChange={onCommitteeChange}>
          <SelectTrigger className="w-full md:w-[280px] bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.10)] text-white hover:border-[rgba(0,200,255,0.35)]">
            <SelectValue placeholder="Filtrar por comitê" />
          </SelectTrigger>
          <SelectContent className="bg-gradient-to-br from-[#0A1612] to-[#07130F] border-[rgba(255,255,255,0.08)] text-white">
            <SelectItem value="all">Todos Comitês</SelectItem>
            {committees.map(committee => (
              <SelectItem key={committee.id} value={committee.id}>
                {committee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
