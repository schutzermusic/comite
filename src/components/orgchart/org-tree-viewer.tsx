'use client';

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrgMember } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { HudButton, HudDrawer } from "@/components/hud";
import { cn } from "@/lib/utils";
import {
  Building2,
  Briefcase,
  Crosshair,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  Focus,
  Layers3,
  Mail,
  Network,
  Plus,
  RotateCcw,
  User,
  Users,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

type DepartmentTone = {
  accent: string;
  className: string;
};

export const departmentColors: Record<string, DepartmentTone> = {
  Diretoria: { accent: "var(--ig-accent)", className: "border-ig-border-focus bg-ig-accent-weak text-ig-accent" },
  Comercial: { accent: "var(--ig-info)", className: "border-[color-mix(in_oklab,var(--ig-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)] text-ig-info" },
  Operações: { accent: "var(--ig-warning)", className: "border-[color-mix(in_oklab,var(--ig-warning)_34%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_12%,transparent)] text-ig-warning" },
  "Segurança Patrimonial": { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success" },
  Zeladoria: { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_26%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_9%,transparent)] text-ig-success" },
  "Manutenção Industrial": { accent: "var(--ig-warning)", className: "border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning" },
  Almoxarifado: { accent: "var(--ig-chart-6)", className: "border-ig-border-strong bg-ig-panel text-ig-fg-muted" },
  "Planejamento & PCP": { accent: "var(--ig-info)", className: "border-[color-mix(in_oklab,var(--ig-info)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)] text-ig-info" },
  "Controle de Qualidade": { accent: "var(--ig-accent)", className: "border-ig-border-focus bg-ig-accent-weak text-ig-accent" },
  "Máquinas e Ferramentas": { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_10%,transparent)] text-[color:var(--ig-chart-3)]" },
  "Caldeiraria/Solda": { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success" },
  Pintura: { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_10%,transparent)] text-[color:var(--ig-chart-3)]" },
  "Montagem & Mecânica": { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_10%,transparent)] text-[color:var(--ig-chart-3)]" },
  Usinagem: { accent: "var(--ig-danger)", className: "border-[color-mix(in_oklab,var(--ig-danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-danger)_9%,transparent)] text-ig-danger" },
  Isolação: { accent: "var(--ig-chart-6)", className: "border-ig-border-strong bg-ig-panel text-ig-fg-muted" },
  Bobinagem: { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_9%,transparent)] text-[color:var(--ig-chart-3)]" },
  "Engenharia Elétrica": { accent: "var(--ig-info)", className: "border-[color-mix(in_oklab,var(--ig-info)_32%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)] text-ig-info" },
  "Engenharia Mecânica": { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success" },
  Ensaios: { accent: "var(--ig-warning)", className: "border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning" },
  Campo: { accent: "var(--ig-accent)", className: "border-ig-border-focus bg-ig-accent-weak text-ig-accent" },
  "Turbo Máquinas": { accent: "var(--ig-warning)", className: "border-[color-mix(in_oklab,var(--ig-warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-warning)_10%,transparent)] text-ig-warning" },
  Jurídico: { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_10%,transparent)] text-[color:var(--ig-chart-3)]" },
  Logística: { accent: "var(--ig-info)", className: "border-[color-mix(in_oklab,var(--ig-info)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-info)_10%,transparent)] text-ig-info" },
  Administrativo: { accent: "var(--ig-chart-6)", className: "border-ig-border-strong bg-ig-panel text-ig-fg-muted" },
  Suprimentos: { accent: "var(--ig-accent)", className: "border-ig-border-focus bg-ig-accent-weak text-ig-accent" },
  Financeiro: { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success" },
  Contábil: { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_26%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_9%,transparent)] text-ig-success" },
  "Recursos Humanos": { accent: "var(--ig-chart-3)", className: "border-[color-mix(in_oklab,var(--ig-chart-3)_28%,transparent)] bg-[color-mix(in_oklab,var(--ig-chart-3)_9%,transparent)] text-[color:var(--ig-chart-3)]" },
  CIPA: { accent: "var(--ig-success)", className: "border-[color-mix(in_oklab,var(--ig-success)_30%,transparent)] bg-[color-mix(in_oklab,var(--ig-success)_10%,transparent)] text-ig-success" },
};

interface OrgTreeViewerProps {
  members: OrgMember[];
  allMembers: OrgMember[];
  departments: string[];
  stats: {
    total: number;
    departments: number;
    managers: number;
    avgTeamSize: number;
  };
  onAddMember: (member: OrgMember) => void;
  onUpdateMember: (member: OrgMember) => void;
}

interface TreeNode {
  member: OrgMember;
  children: TreeNode[];
}

type OrgPersonDraft = {
  id?: string;
  name: string;
  role: string;
  department: string;
  email: string;
  managerId: string;
  status: string;
  employmentType: string;
  notes: string;
};

type ViewTransform = {
  scale: number;
  x: number;
  y: number;
};

const FALLBACK_DEPARTMENT: DepartmentTone = {
  accent: "var(--ig-accent)",
  className: "border-ig-border-strong bg-ig-panel text-ig-fg-muted",
};

function getDepartmentTone(department: string) {
  return departmentColors[department] ?? FALLBACK_DEPARTMENT;
}

function getMemberInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createEmptyDraft(defaultDepartment: string, defaultManagerId = ""): OrgPersonDraft {
  return {
    name: "",
    role: "",
    department: defaultDepartment,
    email: "",
    managerId: defaultManagerId,
    status: "Ativo",
    employmentType: "CLT",
    notes: "",
  };
}

function createDraftFromMember(member: OrgMember): OrgPersonDraft {
  return {
    id: member.id,
    name: member.name,
    role: member.role,
    department: member.department,
    email: member.email,
    managerId: member.managerId ?? "",
    status: "Ativo",
    employmentType: "CLT",
    notes: "",
  };
}

function buildTree(members: OrgMember[]): TreeNode | null {
  const memberMap = new Map<string, TreeNode>();

  members.forEach((member) => {
    memberMap.set(member.id, { member, children: [] });
  });

  let root: TreeNode | null = null;

  members.forEach((member) => {
    const node = memberMap.get(member.id);
    if (!node) return;

    if (!member.managerId) {
      root = node;
      return;
    }

    const manager = memberMap.get(member.managerId);
    if (manager) {
      manager.children.push(node);
    }
  });

  return root;
}

function collectDefaultExpanded(node: TreeNode | null, level = 0, next = new Set<string>()) {
  if (!node) return next;

  if (node.children.length > 0 && level < 2) {
    next.add(node.member.id);
  }

  node.children.forEach((child) => collectDefaultExpanded(child, level + 1, next));
  return next;
}

function getNodePresentation(level: number) {
  if (level === 0) {
    return {
      card: "w-[15.75rem]",
      avatar: "h-12 w-12 rounded-[16px]",
      avatarFallback: "rounded-[16px] text-sm",
      title: "text-[14px]",
      role: "text-[10px]",
      body: "p-4",
      platform: "w-[19rem] h-9",
      lift: "-translate-y-1",
      depth: "[transform:translateZ(34px)_rotateX(7deg)]",
    };
  }

  if (level === 1) {
    return {
      card: "w-[15rem]",
      avatar: "h-11 w-11 rounded-[15px]",
      avatarFallback: "rounded-[15px] text-sm",
      title: "text-[13px]",
      role: "text-[10px]",
      body: "p-3.5",
      platform: "w-[18rem] h-8",
      lift: "-translate-y-0.5",
      depth: "[transform:translateZ(24px)_rotateX(6deg)]",
    };
  }

  return {
    card: "w-[13.25rem]",
    avatar: "h-9 w-9 rounded-[12px]",
    avatarFallback: "rounded-[12px] text-xs",
    title: "text-[11px]",
    role: "text-[9px]",
    body: "p-3",
    platform: "w-[15rem] h-7",
    lift: "",
    depth: "[transform:translateZ(16px)_rotateX(5deg)]",
  };
}

function getPyramidChildrenLayout(level: number, childCount: number) {
  if (level === 0) {
    const widthClass =
      childCount >= 3
        ? "w-[118rem] max-w-[118rem]"
        : childCount === 2
          ? "w-[78rem] max-w-[78rem]"
          : "w-[38rem] max-w-[38rem]";

    return cn(
      "gap-x-8 gap-y-16 px-8 pt-1",
      widthClass,
    );
  }

  if (level === 1) {
    return cn(
      "gap-x-6 gap-y-14 px-5",
      childCount > 3 ? "w-[38rem] max-w-[38rem]" : "w-[31rem] max-w-[31rem]",
    );
  }

  return "w-[29rem] max-w-[29rem] gap-x-5 gap-y-12 px-4";
}

function getCascadeCardClass(level: number) {
  if (level === 0) return "w-[8.8rem] min-h-[3.5rem]";
  if (level === 1) return "w-[8.4rem] min-h-[3.35rem]";
  if (level === 2) return "w-[7.8rem] min-h-[3.15rem]";
  return "w-[7.2rem] min-h-[2.85rem]";
}

function getCascadeChildrenLayout(level: number, childCount: number) {
  if (level === 0) {
    return cn(
      "grid grid-flow-col auto-cols-max grid-rows-1 items-start gap-x-10",
      childCount > 9 && "gap-x-7",
    );
  }

  if (level === 1) {
    return cn(
      "grid grid-flow-col auto-cols-max items-start gap-x-7 gap-y-8",
      childCount > 7 ? "grid-rows-2 gap-x-5" : "grid-rows-1",
    );
  }

  return "flex flex-col items-start gap-2.5";
}

function getCascadeCardSurface(level: number, tone: DepartmentTone) {
  if (level === 0) {
    return {
      background: "linear-gradient(180deg, #11921f 0%, #047512 100%)",
      color: "#FFFFFF",
      borderColor: "#03690f",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.28), 0 2px 5px rgba(15,23,42,0.18)",
    };
  }

  if (level === 1) {
    return {
      background: "linear-gradient(180deg, #fbbf73 0%, #f28b24 100%)",
      color: "#1F2937",
      borderColor: "#c56a17",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 4px rgba(15,23,42,0.14)",
    };
  }

  if (level === 2) {
    return {
      background: `linear-gradient(180deg, color-mix(in oklab, ${tone.accent} 18%, #d9eff7) 0%, color-mix(in oklab, ${tone.accent} 8%, #bfe2ee) 100%)`,
      color: "#0F172A",
      borderColor: `color-mix(in oklab, ${tone.accent} 34%, #7aa7b5)`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.72), 0 1px 3px rgba(15,23,42,0.12)",
    };
  }

  return {
    background: "linear-gradient(180deg, #f7f8f8 0%, #d7dbd8 52%, #bcc2bd 100%)",
    color: "#111827",
    borderColor: "#9ca3af",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.82), 0 1px 2px rgba(15,23,42,0.12)",
  };
}

export function OrgTreeViewer({
  members,
  allMembers,
  departments,
  stats,
  onAddMember,
  onUpdateMember,
}: OrgTreeViewerProps) {
  const [selectedMember, setSelectedMember] = useState<OrgMember | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [view, setView] = useState<ViewTransform>({ scale: 0.5, x: 28, y: 32 });
  const [personDrawerMode, setPersonDrawerMode] = useState<"add" | "edit" | null>(null);
  const [editingMember, setEditingMember] = useState<OrgMember | null>(null);
  const [exporting, setExporting] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const tree = useMemo(() => buildTree(members), [members]);
  const defaultExpanded = useMemo(() => collectDefaultExpanded(tree), [tree]);
  const defaultExpandedKey = useMemo(() => [...defaultExpanded].sort().join("|"), [defaultExpanded]);

  useEffect(() => {
    setExpandedNodes(new Set(defaultExpanded));
  }, [defaultExpandedKey, defaultExpanded]);

  const directReports = useMemo(() => {
    const reportMap = new Map<string, OrgMember[]>();
    members.forEach((member) => {
      if (!member.managerId) return;
      const current = reportMap.get(member.managerId) ?? [];
      current.push(member);
      reportMap.set(member.managerId, current);
    });
    return reportMap;
  }, [members]);

  const zoomPercent = Math.round(view.scale * 100);

  const setScaleAroundPoint = useCallback((nextScale: number, clientX?: number, clientY?: number) => {
    setView((current) => {
      const stage = stageRef.current;
      const scale = clamp(nextScale, 0.12, 2.8);

      if (!stage || clientX === undefined || clientY === undefined) {
        return { ...current, scale };
      }

      const rect = stage.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const contentX = (localX - current.x) / current.scale;
      const contentY = (localY - current.y) / current.scale;

      return {
        scale,
        x: localX - contentX * scale,
        y: localY - contentY * scale,
      };
    });
  }, []);

  const fitToScreen = useCallback(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) return;

    const stageRect = stage.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const unscaledWidth = contentRect.width / view.scale;
    const unscaledHeight = contentRect.height / view.scale;
    const nextScale = clamp(
      Math.min((stageRect.width - 80) / unscaledWidth, (stageRect.height - 90) / unscaledHeight),
      0.12,
      1.4,
    );

    setView({
      scale: nextScale,
      x: (stageRect.width - unscaledWidth * nextScale) / 2,
      y: Math.max(24, (stageRect.height - unscaledHeight * nextScale) / 2),
    });
  }, [view.scale]);

  const resetView = useCallback(() => {
    setView({ scale: 0.5, x: 28, y: 32 });
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const intensity = event.ctrlKey ? 0.004 : 0.0018;
      const nextScale = view.scale * Math.exp(-event.deltaY * intensity);
      setScaleAroundPoint(nextScale, event.clientX, event.clientY);
    };

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [setScaleAroundPoint, view.scale]);


  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-pan-ignore]")) return;

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active || drag.pointerId !== event.pointerId) return;

    setView((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const openAddDrawer = () => {
    setEditingMember(null);
    setPersonDrawerMode("add");
  };

  const openEditDrawer = (member: OrgMember) => {
    setEditingMember(member);
    setSelectedMember(null);
    setPersonDrawerMode("edit");
  };

  const handlePersonSubmit = (draft: OrgPersonDraft) => {
    const fallbackId = `pessoa-${Date.now()}`;
    const baseId = draft.id ?? (slugify(draft.name) || fallbackId);
    const id =
      personDrawerMode === "add" && allMembers.some((member) => member.id === baseId)
        ? `${baseId}-${Date.now().toString(36)}`
        : baseId;
    const member: OrgMember = {
      id,
      name: draft.name.trim(),
      role: draft.role.trim(),
      department: draft.department,
      email: draft.email.trim(),
      managerId: draft.managerId || undefined,
    };

    if (personDrawerMode === "edit") {
      onUpdateMember(member);
      setSelectedMember(member);
    } else {
      onAddMember(member);
    }

    setPersonDrawerMode(null);
    setEditingMember(null);
  };

  const handleExportPdf = async () => {
    setExporting(true);
    fitToScreen();
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    window.print();
    window.setTimeout(() => setExporting(false), 600);
  };

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const renderNode = (node: TreeNode, level = 0) => {
    const isExpanded = expandedNodes.has(node.member.id);
    const isSelected = selectedMember?.id === node.member.id;
    const hasChildren = node.children.length > 0;
    const tone = getDepartmentTone(node.member.department);
    const presentation = getNodePresentation(level);
    const childrenLayout = getPyramidChildrenLayout(level, node.children.length);
    const teamSize = node.children.length;
    const profile = teamSize > 0 ? "Gestor" : "Membro";

    return (
      <div key={node.member.id} className="orgchart-node-3d relative flex flex-col items-center [perspective:1200px]">
        <div className={cn("relative z-20 flex flex-col items-center", presentation.lift)}>
          <div
            role="button"
            tabIndex={0}
            data-pan-ignore
            data-node-card
            onClick={() => setSelectedMember(node.member)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedMember(node.member);
              }
            }}
            className={cn(
              "group relative transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-none",
              presentation.card,
              presentation.depth,
              isSelected && "ring-2 ring-ig-accent ring-offset-4 ring-offset-transparent",
            )}
          >
            <CardDepthSides tone={tone} />
            <div
              className={cn(
                "relative overflow-hidden rounded-[20px] border backdrop-blur-xl",
                "shadow-[0_18px_42px_color-mix(in_oklab,var(--ig-bg-canvas)_68%,transparent),inset_0_1px_0_rgba(255,255,255,0.52)]",
                presentation.body,
              )}
              style={{
                borderColor: `color-mix(in oklab, ${tone.accent} 34%, var(--ig-border-subtle))`,
                background: `linear-gradient(145deg, color-mix(in oklab, var(--ig-bg-panel) 90%, ${tone.accent} 10%), color-mix(in oklab, var(--ig-bg-raised) 76%, transparent))`,
              }}
            >
              <CornerBeams tone={tone} />
              <span
                className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full blur-2xl"
                style={{ background: `color-mix(in oklab, ${tone.accent} 16%, transparent)` }}
              />
              <button
                type="button"
                data-pan-ignore
                onClick={(event) => {
                  event.stopPropagation();
                  openEditDrawer(node.member);
                }}
                className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-ig-border-subtle bg-ig-panel/80 text-ig-fg-muted opacity-0 shadow-[var(--ig-shadow-e1)] transition-opacity hover:border-ig-border-focus hover:text-ig-accent focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                aria-label={`Editar ${node.member.name}`}
                title="Editar pessoa"
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>

              <div className="relative flex items-start gap-3">
                <div className="rounded-[18px] p-[1.5px]" style={{ background: `linear-gradient(145deg, ${tone.accent}, transparent 68%)` }}>
                  <Avatar className={cn("border border-ig-border-subtle shadow-[0_0_20px_color-mix(in_oklab,var(--ig-bg-canvas)_60%,transparent)]", presentation.avatar)}>
                    {node.member.avatarUrl && <AvatarImage src={node.member.avatarUrl} alt={node.member.name} />}
                    <AvatarFallback
                      className={cn(
                        "bg-[linear-gradient(145deg,var(--ig-bg-overlay),var(--ig-bg-raised))] font-semibold text-ig-fg-strong",
                        presentation.avatarFallback,
                      )}
                    >
                      {getMemberInitials(node.member.name)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="min-w-0 flex-1 pr-4">
                  <p className={cn("truncate font-semibold leading-tight text-ig-fg-strong", presentation.title)}>
                    {node.member.name}
                  </p>
                  <p
                    className={cn("mt-1 truncate font-black uppercase leading-tight", presentation.role)}
                    style={{ color: tone.accent }}
                  >
                    {node.member.role}
                  </p>
                </div>
              </div>

              <div className="relative mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-ig-fg-subtle">Equipe</p>
                  <p className="mt-0.5 text-[11px] font-semibold text-ig-fg-strong">
                    {teamSize} {teamSize === 1 ? "direto" : "diretos"}
                  </p>
                </div>
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.16em] text-ig-fg-subtle">Status</p>
                  <p className="mt-0.5 text-[11px] font-semibold" style={{ color: tone.accent }}>
                    {profile}
                  </p>
                </div>
              </div>

              {hasChildren && (
                <button
                  type="button"
                  data-pan-ignore
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleNode(node.member.id);
                  }}
                  className="relative mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-ig-border-subtle bg-ig-panel/70 px-3 text-[10px] font-semibold text-ig-fg-strong shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_45%,transparent)] transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
                  aria-label={isExpanded ? `Ocultar equipe de ${node.member.name}` : `Ver equipe de ${node.member.name}`}
                  title={isExpanded ? "Ocultar equipe" : "Ver equipe"}
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {isExpanded ? "Ocultar equipe" : "Ver equipe"}
                </button>
              )}
            </div>
          </div>

          <NodePlatform tone={tone} className={presentation.platform} />
        </div>

        {hasChildren && isExpanded && (
          <div className="relative flex flex-col items-center">
            <ConnectionStem level={level} />
            <div className={cn("relative flex flex-wrap items-start justify-center", childrenLayout)}>
              {node.children.length > 1 && <SiblingRail />}
              {node.children.map((child) => (
                <div key={child.member.id} className="relative flex flex-col items-center">
                  <ConnectionDrop />
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
    <div className="relative overflow-hidden rounded-[var(--ig-radius-xl)]">
      <div className="relative flex flex-col gap-4 border-b border-ig-border-focus/25 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-bg-panel)_82%,transparent),color-mix(in_oklab,var(--ig-bg-raised)_28%,transparent))] p-4 md:flex-row md:items-center md:justify-between">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-ig-accent to-transparent opacity-80" />
        <div className="flex min-w-0 items-center gap-3">
          <div className="ig-icon-jewel flex h-10 w-10 items-center justify-center text-ig-accent">
            <Network className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ig-fg-subtle">
              Architecture View
            </p>
            <h2 className="truncate text-lg font-semibold text-ig-fg-strong">
              Mapa hierárquico executivo
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-pan-ignore>
          <button
            type="button"
            onClick={openAddDrawer}
            className="flex h-10 items-center gap-2 rounded-xl border border-ig-border-focus bg-ig-accent-weak px-3 text-xs font-semibold text-ig-accent transition-colors hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
          >
            <Plus className="h-4 w-4" />
            Adicionar pessoa
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            className="flex h-10 items-center gap-2 rounded-xl border border-ig-border-subtle bg-ig-panel px-3 text-xs font-semibold text-ig-fg-strong transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
          >
            <Download className="h-4 w-4 text-ig-accent" />
            Exportar PDF
          </button>
        </div>

        <div className="ig-glass inline-flex w-fit items-center gap-2 rounded-xl p-1" data-elev="2" data-pan-ignore>
          <span data-ig-noise="" />
          <span data-ig-specular="" />
          <div data-ig-content="" className="flex items-center gap-1">
            <ToolbarButton
              label="Reduzir zoom"
              onClick={() => setScaleAroundPoint(view.scale / 1.18)}
              disabled={view.scale <= 0.12}
              icon={<ZoomOut className="h-4 w-4" />}
            />
            <span className="min-w-16 rounded-lg border border-ig-border-subtle bg-ig-panel px-3 py-1.5 text-center font-mono text-xs font-semibold text-ig-fg-strong">
              {zoomPercent}%
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-ig-fg-subtle" />
            <ToolbarButton
              label="Aumentar zoom"
              onClick={() => setScaleAroundPoint(view.scale * 1.18)}
              disabled={view.scale >= 2.8}
              icon={<ZoomIn className="h-4 w-4" />}
            />
            <ToolbarButton
              label="Ajustar à tela"
              onClick={fitToScreen}
              icon={<Crosshair className="h-4 w-4" />}
            />
            <ToolbarButton
              label="Restaurar zoom"
              onClick={resetView}
              icon={<RotateCcw className="h-4 w-4" />}
            />
            <span className="mx-1 h-5 w-px bg-ig-border-subtle" />
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-lg border border-ig-border-subtle bg-ig-panel px-3 text-xs font-semibold text-ig-fg-strong transition-colors hover:border-ig-border-focus hover:bg-ig-panel-hover focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
            >
              <Layers3 className="h-4 w-4 text-ig-accent" />
              Camadas
            </button>
          </div>
        </div>
      </div>

      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={cn(
          "orgchart-stage-surface relative min-h-[760px] touch-none overflow-hidden bg-[radial-gradient(ellipse_at_50%_22%,color-mix(in_oklab,var(--ig-accent)_20%,transparent),transparent_38%),radial-gradient(ellipse_at_50%_100%,color-mix(in_oklab,var(--ig-info)_13%,transparent),transparent_58%),linear-gradient(90deg,color-mix(in_oklab,var(--ig-border-subtle)_76%,transparent)_1px,transparent_1px),linear-gradient(180deg,color-mix(in_oklab,var(--ig-border-subtle)_76%,transparent)_1px,transparent_1px)] bg-[size:auto,auto,56px_56px,56px_56px] p-5 md:p-8",
          "cursor-grab active:cursor-grabbing",
          exporting && "print:min-h-0 print:overflow-visible",
        )}
      >
        <OrgRadar total={stats.total} />
        <div className="hidden print:mb-4 print:block">
          <div className="rounded-xl border border-ig-border-subtle bg-ig-panel p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ig-accent">Insight Apex Board</p>
                <h1 className="mt-1 text-xl font-semibold text-ig-fg-strong">Organograma Executivo</h1>
                <p className="mt-1 text-xs text-ig-fg-muted">Exportado em {new Date().toLocaleDateString("pt-BR")}</p>
              </div>
              <div className="grid grid-cols-4 gap-2 text-right">
                <PrintMetric label="Colaboradores" value={stats.total} />
                <PrintMetric label="Departamentos" value={stats.departments} />
                <PrintMetric label="Gestores" value={stats.managers} />
                <PrintMetric label="Média/equipe" value={stats.avgTeamSize} />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {departments.slice(0, 18).map((department) => (
                <span key={department} className="rounded-full border border-ig-border-subtle px-2 py-1 text-[10px] text-ig-fg-muted">
                  {department}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div
          ref={contentRef}
          className={cn(
            "relative z-10 flex w-max min-w-max justify-center pt-2 will-change-transform",
            dragRef.current?.active ? "transition-none" : "transition-transform duration-200 ease-out",
            exporting && "print:translate-x-0 print:translate-y-0 print:scale-[0.55]",
          )}
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            transformOrigin: "top left",
          }}
        >
          {tree ? (
            renderNode(tree)
          ) : (
            <EmptyState />
          )}
        </div>
      </div>

      <MemberDrawer
        member={selectedMember}
        members={members}
        reports={selectedMember ? directReports.get(selectedMember.id) ?? [] : []}
        onEdit={selectedMember ? () => openEditDrawer(selectedMember) : undefined}
        onClose={() => setSelectedMember(null)}
      />

      <PersonFormDrawer
        mode={personDrawerMode}
        member={editingMember}
        members={allMembers}
        departments={departments}
        onSubmit={handlePersonSubmit}
        onClose={() => {
          setPersonDrawerMode(null);
          setEditingMember(null);
        }}
      />
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-ig-fg-muted transition-colors hover:border-ig-border-focus hover:bg-ig-accent-weak hover:text-ig-accent focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
    </button>
  );
}

function CornerBeams({ tone }: { tone: DepartmentTone }) {
  return (
    <>
      <span
        className="pointer-events-none absolute inset-x-6 top-0 h-px opacity-90"
        style={{ background: `linear-gradient(90deg, transparent, ${tone.accent}, transparent)` }}
      />
      <span className="pointer-events-none absolute left-0 top-0 h-6 w-6 border-l border-t border-ig-border-focus/70" />
      <span className="pointer-events-none absolute right-0 top-0 h-6 w-6 border-r border-t border-ig-border-focus/70" />
      <span className="pointer-events-none absolute bottom-0 left-0 h-6 w-6 border-b border-l border-ig-border-subtle" />
      <span className="pointer-events-none absolute bottom-0 right-0 h-6 w-6 border-b border-r border-ig-border-subtle" />
    </>
  );
}

function CardDepthSides({ tone }: { tone: DepartmentTone }) {
  return (
    <>
      <span
        className="pointer-events-none absolute bottom-0 left-3 right-3 h-3 rounded-b-[18px] border-x border-b border-ig-border-focus/35 opacity-90 [transform:translateY(8px)_skewX(-28deg)]"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${tone.accent} 22%, transparent), color-mix(in oklab, var(--ig-bg-canvas) 92%, transparent))`,
        }}
      />
      <span
        className="pointer-events-none absolute bottom-2 right-0 top-4 w-3 rounded-r-[18px] border-r border-ig-border-focus/25 opacity-70 [transform:translateX(7px)_skewY(32deg)]"
        style={{
          background: `linear-gradient(90deg, color-mix(in oklab, ${tone.accent} 18%, transparent), color-mix(in oklab, var(--ig-bg-canvas) 90%, transparent))`,
        }}
      />
    </>
  );
}

function NodePlatform({
  tone,
  className,
}: {
  tone: DepartmentTone;
  className: string;
}) {
  return (
    <div className={cn("relative -mt-2 flex items-end justify-center [perspective:700px]", className)}>
      <div
        className="absolute inset-x-2 bottom-0 h-5 rounded-[50%] border border-ig-border-focus/45 bg-[linear-gradient(180deg,color-mix(in_oklab,var(--ig-bg-raised)_70%,transparent),color-mix(in_oklab,var(--ig-bg-canvas)_80%,transparent))] shadow-[0_16px_42px_color-mix(in_oklab,var(--ig-bg-canvas)_88%,transparent)] [transform:rotateX(58deg)]"
        style={{
          boxShadow: `0 18px 42px color-mix(in oklab, ${tone.accent} 16%, transparent), inset 0 1px 0 color-mix(in oklab, ${tone.accent} 34%, transparent)`,
        }}
      />
      <div
        className="absolute inset-x-7 bottom-1 h-3 rounded-[50%] blur-sm"
        style={{ background: `color-mix(in oklab, ${tone.accent} 22%, transparent)` }}
      />
      <div
        className="absolute bottom-1 h-1 w-14 rounded-full shadow-[0_0_22px_currentColor]"
        style={{ color: tone.accent, backgroundColor: "currentColor" }}
      />
    </div>
  );
}

function ConnectionStem({ level }: { level: number }) {
  return (
    <div
      className={cn(
        "relative w-0.5 bg-ig-accent shadow-[0_0_18px_color-mix(in_oklab,var(--ig-accent)_72%,transparent)]",
        level === 0 ? "h-16" : "h-10",
      )}
    >
      <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ig-accent shadow-[0_0_22px_var(--ig-accent)]" />
      <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ig-accent shadow-[0_0_20px_var(--ig-accent)]" />
    </div>
  );
}

function CascadeStem() {
  return (
    <div className="h-8 w-px bg-[#7fb55d]" />
  );
}

function CascadeDrop() {
  return (
    <div className="h-5 w-px bg-[#7fb55d]" />
  );
}

function CascadeRail() {
  return (
    <div className="absolute left-10 right-10 top-0 h-px bg-[#7fb55d]" />
  );
}

function ConnectionDrop() {
  return (
    <div className="relative h-10 w-0.5 bg-ig-accent shadow-[0_0_16px_color-mix(in_oklab,var(--ig-accent)_66%,transparent)]">
      <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ig-accent shadow-[0_0_18px_var(--ig-accent)]" />
      <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-ig-accent shadow-[0_0_16px_var(--ig-accent)]" />
    </div>
  );
}

function SiblingRail() {
  return (
    <div className="absolute left-10 right-10 top-0 z-0 h-0.5 bg-ig-accent shadow-[0_0_22px_color-mix(in_oklab,var(--ig-accent)_70%,transparent)]">
      <span className="absolute inset-x-16 top-1 h-8 rounded-[50%] border-t border-ig-border-focus/45 opacity-80 [transform:rotateX(62deg)]" />
      <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-ig-accent shadow-[0_0_18px_var(--ig-accent)]" />
      <span className="absolute right-0 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-ig-accent shadow-[0_0_18px_var(--ig-accent)]" />
    </div>
  );
}

function OrgRadar({ total }: { total: number }) {
  return (
    <div className="pointer-events-none absolute right-12 top-28 hidden h-40 w-40 items-center justify-center text-ig-accent opacity-80 xl:flex">
      <div className="absolute inset-0 rounded-full border border-ig-border-focus/60 shadow-[0_0_32px_color-mix(in_oklab,var(--ig-accent)_18%,transparent)]" />
      <div className="absolute inset-3 rounded-full border border-dashed border-ig-border-focus/55" />
      <div className="absolute inset-7 rounded-full border border-ig-border-subtle" />
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-ig-border-focus to-transparent" />
      <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-gradient-to-r from-transparent via-ig-border-focus to-transparent" />
      <div className="relative text-center">
        <p className="text-3xl font-semibold tabular-nums text-ig-accent">{total}</p>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-ig-accent">
          Colaboradores
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-[var(--ig-radius-xl)] border border-ig-border-default bg-ig-panel/70 p-8 text-center shadow-[var(--ig-shadow-e2)] backdrop-blur-xl">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
        <User className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold text-ig-fg-strong">
        Nenhuma estrutura encontrada
      </h3>
      <p className="mt-2 text-sm text-ig-fg-muted">
        Ajuste a busca ou o filtro de departamento para reabrir a visualização hierárquica.
      </p>
    </div>
  );
}

function MemberDrawer({
  member,
  members,
  reports,
  onEdit,
  onClose,
}: {
  member: OrgMember | null;
  members: OrgMember[];
  reports: OrgMember[];
  onEdit?: () => void;
  onClose: () => void;
}) {
  const tone = member ? getDepartmentTone(member.department) : FALLBACK_DEPARTMENT;
  const manager = member?.managerId ? members.find((m) => m.id === member.managerId) : undefined;

  return (
    <HudDrawer
      isOpen={!!member}
      onClose={onClose}
      title="Detalhes do Colaborador"
      subtitle="Perfil hierárquico e vínculo organizacional"
      width="430px"
    >
      {member && (
        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-[var(--ig-radius-xl)] border border-ig-border-default bg-ig-panel/70 p-5">
            <span
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: `linear-gradient(90deg, transparent, ${tone.accent}, transparent)` }}
            />
            <div className="relative flex items-center gap-4">
              <div className="rounded-2xl p-[2px]" style={{ background: `linear-gradient(145deg, ${tone.accent}, transparent)` }}>
                <Avatar className="h-16 w-16 rounded-[18px] border border-ig-border-subtle">
                  {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt={member.name} />}
                  <AvatarFallback className="rounded-[18px] bg-[linear-gradient(145deg,var(--ig-bg-overlay),var(--ig-bg-raised))] text-lg font-semibold text-ig-fg-strong">
                    {getMemberInitials(member.name)}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-xl font-semibold text-ig-fg-strong">{member.name}</h3>
                <p className="mt-1 text-sm text-ig-fg-muted">{member.role}</p>
                <span className={cn("mt-3 inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]", tone.className)}>
                  <Building2 className="mr-1.5 h-3 w-3" />
                  <span className="truncate">{member.department}</span>
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DrawerMetric icon={<Users className="h-4 w-4" />} label="Equipe direta" value={`${reports.length}`} />
            <DrawerMetric icon={<Focus className="h-4 w-4" />} label="Perfil" value={reports.length > 0 ? "Gestor" : "Membro"} />
          </div>

          <div className="space-y-3 rounded-[var(--ig-radius-lg)] border border-ig-border-subtle bg-ig-panel/45 p-4">
            <DetailRow
              icon={<Mail className="h-4 w-4" />}
              label="E-mail"
              value={
                <a href={`mailto:${member.email}`} className="text-ig-accent transition-colors hover:text-ig-accent-strong">
                  {member.email}
                </a>
              }
            />
            <DetailRow
              icon={<Briefcase className="h-4 w-4" />}
              label="Gestor direto"
              value={manager?.name ?? "N/A"}
            />
            <DetailRow
              icon={<Network className="h-4 w-4" />}
              label="Identificador"
              value={<span className="font-mono text-xs">{member.id}</span>}
            />
          </div>

          {reports.length > 0 && (
            <div className="rounded-[var(--ig-radius-lg)] border border-ig-border-subtle bg-ig-panel/45 p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">
                Colaboradores diretos
              </p>
              <div className="space-y-2">
                {reports.map((report) => (
                  <div key={report.id} className="flex items-center justify-between gap-3 rounded-lg border border-ig-border-subtle bg-ig-bg-raised/45 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ig-fg-strong">{report.name}</p>
                      <p className="truncate text-xs text-ig-fg-muted">{report.role}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ig-fg-subtle" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <HudButton
              type="button"
              variant="primary"
              fullWidth
              leftIcon={<Edit3 className="h-4 w-4" />}
              onClick={onEdit}
            >
              Editar pessoa
            </HudButton>
            <HudButton
              type="button"
              variant="glass"
              fullWidth
              leftIcon={<ChevronDown className="h-4 w-4" />}
              onClick={onClose}
            >
              Fechar
            </HudButton>
          </div>
        </div>
      )}
    </HudDrawer>
  );
}

function PersonFormDrawer({
  mode,
  member,
  members,
  departments,
  onSubmit,
  onClose,
}: {
  mode: "add" | "edit" | null;
  member: OrgMember | null;
  members: OrgMember[];
  departments: string[];
  onSubmit: (draft: OrgPersonDraft) => void;
  onClose: () => void;
}) {
  const defaultDepartment = departments[0] ?? "Diretoria";
  const [draft, setDraft] = useState<OrgPersonDraft>(() => createEmptyDraft(defaultDepartment));

  useEffect(() => {
    if (mode === "edit" && member) {
      setDraft(createDraftFromMember(member));
    } else if (mode === "add") {
      setDraft(createEmptyDraft(defaultDepartment, members[0]?.id ?? ""));
    }
  }, [defaultDepartment, member, members, mode]);

  const updateDraft = (field: keyof OrgPersonDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.role.trim() || !draft.department || !draft.email.trim()) {
      return;
    }
    onSubmit(draft);
  };

  return (
    <HudDrawer
      isOpen={mode !== null}
      onClose={onClose}
      title={mode === "edit" ? "Editar pessoa" : "Adicionar pessoa"}
      subtitle="Fluxo local/mock isolado para gestão do organograma"
      width="520px"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-[var(--ig-radius-xl)] border border-ig-border-focus/35 bg-ig-accent-weak/35 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-ig-border-focus bg-ig-panel text-ig-accent">
              {mode === "edit" ? <Edit3 className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
            </div>
            <div>
              <p className="text-sm font-semibold text-ig-fg-strong">
                {mode === "edit" ? "Atualização de cadastro local" : "Novo nó organizacional"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ig-fg-muted">
                Sem persistência backend nesta etapa. As alterações atualizam somente o estado local da página.
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nome" required>
            <input
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              className={formInputClass}
              placeholder="Nome completo"
            />
          </FormField>
          <FormField label="Cargo" required>
            <input
              value={draft.role}
              onChange={(event) => updateDraft("role", event.target.value)}
              className={formInputClass}
              placeholder="Cargo ou função"
            />
          </FormField>
          <FormField label="Departamento" required>
            <select
              value={draft.department}
              onChange={(event) => updateDraft("department", event.target.value)}
              className={formInputClass}
            >
              {departments.map((department) => (
                <option key={department} value={department} className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
                  {department}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Gestor/responsável">
            <select
              value={draft.managerId}
              onChange={(event) => updateDraft("managerId", event.target.value)}
              className={formInputClass}
            >
              <option value="" className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
                Sem gestor direto
              </option>
              {members
                .filter((candidate) => candidate.id !== draft.id)
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id} className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
                    {candidate.name} - {candidate.role}
                  </option>
                ))}
            </select>
          </FormField>
          <FormField label="E-mail" required>
            <input
              value={draft.email}
              onChange={(event) => updateDraft("email", event.target.value)}
              className={formInputClass}
              placeholder="nome@empresa.com"
              type="email"
            />
          </FormField>
          <FormField label="Status">
            <select
              value={draft.status}
              onChange={(event) => updateDraft("status", event.target.value)}
              className={formInputClass}
            >
              {["Ativo", "Em onboarding", "Temporário", "Vaga"].map((status) => (
                <option key={status} value={status} className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
                  {status}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Tipo de vínculo">
            <select
              value={draft.employmentType}
              onChange={(event) => updateDraft("employmentType", event.target.value)}
              className={formInputClass}
            >
              {["CLT", "PJ", "Terceiro", "Temporário", "Conselho"].map((type) => (
                <option key={type} value={type} className="bg-[color:var(--ig-bg-raised)] text-[color:var(--ig-fg-strong)]">
                  {type}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        <FormField label="Observações">
          <textarea
            value={draft.notes}
            onChange={(event) => updateDraft("notes", event.target.value)}
            className={cn(formInputClass, "min-h-24 resize-none py-3")}
            placeholder="Notas internas para futura persistência..."
          />
        </FormField>

        <div className="flex items-center justify-end gap-2 border-t border-ig-border-subtle pt-4">
          <HudButton type="button" variant="glass" onClick={onClose}>
            Cancelar
          </HudButton>
          <HudButton type="submit" variant="primary" leftIcon={mode === "edit" ? <Edit3 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}>
            {mode === "edit" ? "Salvar edição" : "Adicionar pessoa"}
          </HudButton>
        </div>
      </form>
    </HudDrawer>
  );
}

const formInputClass = cn(
  "h-11 w-full rounded-xl border border-ig-border-subtle bg-ig-panel/70 px-3 text-sm text-ig-fg-strong",
  "shadow-[inset_0_1px_0_color-mix(in_oklab,var(--ig-border-strong)_42%,transparent)]",
  "placeholder:text-ig-fg-subtle focus:border-ig-border-focus focus:outline-none focus:shadow-[var(--ig-focus-ring-outer)]",
);

function FormField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ig-fg-subtle">
        {label}
        {required && <span className="ml-1 text-ig-accent">*</span>}
      </span>
      {children}
    </label>
  );
}

function PrintMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-lg font-semibold tabular-nums text-ig-fg-strong">{value}</p>
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
    </div>
  );
}

function DrawerMetric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[var(--ig-radius-lg)] border border-ig-border-subtle bg-ig-panel/45 p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-ig-border-focus bg-ig-accent-weak text-ig-accent">
        {icon}
      </div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold text-ig-fg-strong">{value}</p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ig-border-subtle bg-ig-panel text-ig-fg-muted">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ig-fg-subtle">{label}</p>
        <div className="mt-1 break-words text-sm text-ig-fg-strong">{value}</div>
      </div>
    </div>
  );
}
