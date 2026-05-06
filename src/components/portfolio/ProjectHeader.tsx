'use client';

import Link from 'next/link';
import { FolderKanban, Plus, Download, FileText, Printer } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { cn } from '@/lib/utils';
import { useState } from 'react';

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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      className={cn(
        'relative overflow-hidden',
        'glass-tile glass-tile-elevated glass-tile-sheen',
        'px-5 py-5 md:px-6 md:py-6 mb-5',
        className,
      )}
    >
      {/* Soft accent halo */}
      <span
        className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(16,185,129,0.16) 0%, transparent 65%)',
        }}
      />
      {/* Premium top hairline */}
      <span
        className="pointer-events-none absolute inset-x-6 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgba(16,185,129,0.55) 30%, rgba(34,211,238,0.45) 70%, transparent 100%)',
        }}
      />

      <div className="relative flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <div className="flex items-center gap-3 md:gap-4">
          <div
            className="flex items-center justify-center w-11 h-11 rounded-2xl shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(34,211,238,0.1))',
              border: '1px solid rgba(16,185,129,0.30)',
              color: '#34D399',
              boxShadow: '0 0 24px rgba(16,185,129,0.18)',
            }}
          >
            <FolderKanban className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold hud-text leading-tight tracking-tight">
                {title}
              </h1>
              {typeof count === 'number' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border hud-surface hud-text-secondary">
                  {count}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-sm hud-text-muted leading-snug max-w-xl">{subtitle}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 md:ml-auto">
          {/* Export menu */}
          <div className="relative">
            <HudButton
              variant="secondary"
              size="md"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={() => setMenuOpen((v) => !v)}
            >
              Exportar
            </HudButton>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-2 w-60 rounded-xl border hud-surface shadow-xl z-40 backdrop-blur-xl overflow-hidden">
                  <MenuItem
                    icon={<FileText className="w-4 h-4" />}
                    label="CSV (planilha)"
                    description="Exportar lista filtrada"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportCsv();
                    }}
                  />
                  <MenuItem
                    icon={<Printer className="w-4 h-4" />}
                    label="PDF — Sumário Executivo"
                    description="Top 10 + KPIs · 1–2 páginas"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPdf('executive');
                    }}
                  />
                  <MenuItem
                    icon={<Printer className="w-4 h-4" />}
                    label="PDF — Portfólio Completo"
                    description="Todos os projetos filtrados"
                    onClick={() => {
                      setMenuOpen(false);
                      onExportPdf('full');
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <Link href={newProjectHref}>
            <HudButton variant="primary" size="md" leftIcon={<Plus className="w-4 h-4" />}>
              Novo Projeto
            </HudButton>
          </Link>
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-emerald-500/10 transition-colors border-b last:border-b-0 hud-divider"
    >
      <span className="mt-0.5 hud-text-secondary">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium hud-text">{label}</p>
        {description && <p className="text-xs hud-text-muted">{description}</p>}
      </div>
    </button>
  );
}

export default ProjectHeader;
