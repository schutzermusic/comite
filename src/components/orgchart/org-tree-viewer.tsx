'use client';

import { useState } from "react";
import { OrgMember } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { 
  User, 
  Mail, 
  Building2, 
  Briefcase,
  ChevronDown,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2
} from "lucide-react";

export const departmentColors: Record<string, string> = {
  Diretoria: "bg-emerald-100 text-emerald-700 border-emerald-300",
  Comercial: "bg-cyan-100 text-cyan-700 border-cyan-300",
  Operações: "bg-amber-100 text-amber-700 border-amber-300",
  "Segurança Patrimonial": "bg-green-100 text-green-700 border-green-300",
  Zeladoria: "bg-lime-100 text-lime-700 border-lime-300",
  "Manutenção Industrial": "bg-orange-100 text-orange-700 border-orange-300",
  Almoxarifado: "bg-slate-100 text-slate-700 border-slate-300",
  "Planejamento & PCP": "bg-blue-100 text-blue-700 border-blue-300",
  "Controle de Qualidade": "bg-teal-100 text-teal-700 border-teal-300",
  "Máquinas e Ferramentas": "bg-indigo-100 text-indigo-700 border-indigo-300",
  "Caldeiraria/Solda": "bg-emerald-100 text-emerald-700 border-emerald-300",
  Pintura: "bg-purple-100 text-purple-700 border-purple-300",
  "Montagem & Mecânica": "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-300",
  Usinagem: "bg-rose-100 text-rose-700 border-rose-300",
  Isolação: "bg-slate-200 text-slate-800 border-slate-300",
  Bobinagem: "bg-pink-100 text-pink-700 border-pink-300",
  "Engenharia Elétrica": "bg-cyan-100 text-cyan-700 border-cyan-300",
  "Engenharia Mecânica": "bg-emerald-100 text-emerald-700 border-emerald-300",
  Ensaios: "bg-orange-100 text-orange-700 border-orange-300",
  Campo: "bg-teal-100 text-teal-700 border-teal-300",
  "Turbo Máquinas": "bg-orange-100 text-orange-800 border-orange-300",
  Jurídico: "bg-indigo-100 text-indigo-700 border-indigo-300",
  Logística: "bg-sky-100 text-sky-700 border-sky-300",
  Administrativo: "bg-gray-100 text-gray-700 border-gray-300",
  Suprimentos: "bg-teal-100 text-teal-700 border-teal-300",
  Financeiro: "bg-emerald-100 text-emerald-700 border-emerald-300",
  Contábil: "bg-lime-100 text-lime-700 border-lime-300",
  "Recursos Humanos": "bg-pink-100 text-pink-700 border-pink-300",
  CIPA: "bg-green-100 text-green-700 border-green-300",
  ComercialSupport: "bg-cyan-100 text-cyan-700 border-cyan-300",
};

interface OrgTreeViewerProps {
  members: OrgMember[];
}

interface TreeNode {
  member: OrgMember;
  children: TreeNode[];
}

export function OrgTreeViewer({ members }: OrgTreeViewerProps) {
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(100);

  // Build tree structure
  const buildTree = (): TreeNode | null => {
    const memberMap = new Map<string, TreeNode>();
    
    // Initialize all nodes
    members.forEach(member => {
      memberMap.set(member.id, { member, children: [] });
    });

    // Build relationships
    let root: TreeNode | null = null;
    members.forEach(member => {
      const node = memberMap.get(member.id)!;
      
      if (!member.managerId) {
        // This is the CEO
        root = node;
      } else {
        const manager = memberMap.get(member.managerId);
        if (manager) {
          manager.children.push(node);
        }
      }
    });

    return root;
  };

  const tree = buildTree();

  const toggleNode = (nodeId: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const getMemberInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getDepartmentColor = (department: string) => {
    return departmentColors[department] || "bg-slate-100 text-slate-700 border-slate-300";
  };

  const renderNode = (node: TreeNode, level: number = 0) => {
    const isExpanded = expandedNodes.has(node.member.id);
    const hasChildren = node.children.length > 0;

    return (
      <div key={node.member.id} className="flex flex-col items-center">
        {/* Node Card */}
        <Card 
          className="p-4 border-2 border-slate-200 bg-white hover:border-emerald-300 hover:shadow-lg transition-all cursor-pointer w-64"
          onClick={() => setSelectedMember(node.member)}
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Avatar className="w-12 h-12 border-2 border-slate-200">
                <AvatarFallback className="bg-gradient-to-br from-slate-600 to-slate-800 text-white font-semibold">
                  {getMemberInitials(node.member.name)}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-slate-900 truncate">{node.member.name}</h4>
                <p className="text-sm text-slate-600 truncate">{node.member.role}</p>
              </div>
            </div>

            <Badge 
              variant="outline" 
              className={`text-xs font-medium w-full justify-center ${getDepartmentColor(node.member.department)}`}
            >
              {node.member.department}
            </Badge>

            {hasChildren && (
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(node.member.id);
                }}
              >
                {isExpanded ? (
                  <>
                    <ChevronDown className="w-3 h-3 mr-1" />
                    Ocultar Equipe ({node.children.length})
                  </>
                ) : (
                  <>
                    <ChevronRight className="w-3 h-3 mr-1" />
                    Ver Equipe ({node.children.length})
                  </>
                )}
              </Button>
            )}
          </div>
        </Card>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="flex flex-col items-center mt-8">
            {/* Vertical Line */}
            <div className="w-0.5 h-8 bg-slate-300" />
            
            {/* Children Container */}
            <div className="flex gap-8">
              {node.children.map(child => (
                <div key={child.member.id} className="flex flex-col items-center">
                  {/* Connection Line */}
                  <div className="w-0.5 h-8 bg-slate-300" />
                  {renderNode(child, level + 1)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Zoom Controls */}
      <Card className="p-3 border-slate-200 inline-flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom(Math.max(50, zoom - 10))}
          disabled={zoom <= 50}
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-sm font-medium text-slate-700 w-16 text-center">
          {zoom}%
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom(Math.min(150, zoom + 10))}
          disabled={zoom >= 150}
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom(100)}
        >
          <Maximize2 className="w-4 h-4" />
        </Button>
      </Card>

      {/* Tree Container */}
      <Card className="p-8 border-slate-200 overflow-auto">
        <div 
          className="flex justify-center transition-transform"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          {tree ? (
            renderNode(tree)
          ) : (
            <div className="text-center py-12 text-slate-500">
              <User className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p>Nenhuma estrutura organizacional encontrada</p>
            </div>
          )}
        </div>
      </Card>

      {/* Member Detail Sheet */}
      <Sheet open={!!selectedMember} onOpenChange={() => setSelectedMember(null)}>
        <SheetContent className="w-[400px]">
          {selectedMember && (
            <>
              <SheetHeader>
                <SheetTitle>Detalhes do Colaborador</SheetTitle>
                <SheetDescription>
                  Informações completas do membro da equipe
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Avatar & Name */}
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16 border-2 border-slate-200">
                    <AvatarFallback className="bg-gradient-to-br from-slate-600 to-slate-800 text-white font-semibold text-lg">
                      {getMemberInitials(selectedMember.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{selectedMember.name}</h3>
                    <p className="text-sm text-slate-600">{selectedMember.role}</p>
                  </div>
                </div>

                {/* Department */}
                <div>
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Departamento
                  </label>
                  <Badge 
                    variant="outline" 
                    className={`mt-2 ${getDepartmentColor(selectedMember.department)}`}
                  >
                    {selectedMember.department}
                  </Badge>
                </div>

                {/* Email */}
                <div>
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    E-mail
                  </label>
                  <a 
                    href={`mailto:${selectedMember.email}`}
                    className="mt-1 text-sm text-emerald-600 hover:text-emerald-700 block"
                  >
                    {selectedMember.email}
                  </a>
                </div>

                {/* Manager */}
                {selectedMember.managerId && (
                  <div>
                    <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                      <Briefcase className="w-4 h-4" />
                      Gestor Direto
                    </label>
                    <p className="mt-1 text-sm text-slate-900">
                      {members.find(m => m.id === selectedMember.managerId)?.name || 'N/A'}
                    </p>
                  </div>
                )}

                {/* Team Size */}
                <div>
                  <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Equipe Direta
                  </label>
                  <p className="mt-1 text-sm text-slate-900">
                    {members.filter(m => m.managerId === selectedMember.id).length} colaboradores
                  </p>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
