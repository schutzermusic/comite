'use client';

import Link from 'next/link';
import { FolderKanban, Plus, Download, FileText, Printer } from 'lucide-react';
import { HudHeader, HudButton } from '@/components/hud';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ProjectHeaderProps {
  title: string;
  subtitle?: string;
  count?: number;
  onExportCsv: () => void;
  onExportPdf: (mode: 'executive' | 'full') => void;
  newProjectHref?: string;
  className?: string;
}

export function ProjectHeader({
  title,
  subtitle,
  count,
  onExportCsv,
  onExportPdf,
  newProjectHref = '/projetos/novo',
  className,
}: ProjectHeaderProps) {
  return (
    <HudHeader
      className={className}
      title={title}
      subtitle={subtitle}
      icon={<FolderKanban className="h-5 w-5" />}
      iconTint="var(--ig-accent)"
      breadcrumbs={[{ label: title }]}
      statusChips={
        typeof count === 'number'
          ? [{ label: `${count} projetos`, variant: 'info' }]
          : undefined
      }
      actions={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <HudButton variant="glass" size="md" leftIcon={<Download className="h-4 w-4" />}>
                Exportar
              </HudButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={onExportCsv} className="flex items-start gap-3 py-2.5">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
                <div>
                  <p className="text-sm font-medium">CSV (planilha)</p>
                  <p className="text-xs text-ig-fg-muted">Exportar lista filtrada</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onExportPdf('executive')}
                className="flex items-start gap-3 py-2.5"
              >
                <Printer className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
                <div>
                  <p className="text-sm font-medium">PDF — Sumário Executivo</p>
                  <p className="text-xs text-ig-fg-muted">Top 10 + KPIs · 1–2 páginas</p>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onExportPdf('full')}
                className="flex items-start gap-3 py-2.5"
              >
                <Printer className="mt-0.5 h-4 w-4 shrink-0 text-ig-fg-muted" />
                <div>
                  <p className="text-sm font-medium">PDF — Portfólio Completo</p>
                  <p className="text-xs text-ig-fg-muted">Todos os projetos filtrados</p>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Link href={newProjectHref}>
            <HudButton variant="primary" size="md" leftIcon={<Plus className="h-4 w-4" />}>
              Novo Projeto
            </HudButton>
          </Link>
        </>
      }
    />
  );
}

export default ProjectHeader;
