'use client';

/**
 * Standard "Exportar PDF" affordance for module reports.
 *
 * Centralizes the export UX shared by every module: RBAC gating, the
 * "Gerando PDF…" loading state, deferring one frame so the spinner paints
 * before the (synchronous) HTML build, and surfacing popup-blocked / failure
 * via the HUD toast. The page passes a `build` closure capturing its CURRENT
 * view-model + filters, so the report always reflects what's on screen.
 */

import { useState, useCallback } from 'react';
import { Download } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { useHudToast } from '@/hooks/useHudToast';
import { usePermissions } from '@/hooks/use-permissions';
import type { ReportExportResult } from '@/lib/reports/report-types';

export interface ExportReportButtonProps {
  /** Returns the export result (e.g. openRiskReport(payload)). May throw. */
  build: () => ReportExportResult;
  /** RBAC permission required to export. Hidden when the user lacks it. */
  permission?: string;
  /** Optional fallback permission (e.g. module view) when no export key applies. */
  fallbackPermission?: string;
  label?: string;
  loadingLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
}

export function ExportReportButton({
  build,
  permission,
  fallbackPermission,
  label = 'Exportar PDF',
  loadingLabel = 'Gerando PDF…',
  size = 'md',
  variant = 'glass',
}: ExportReportButtonProps) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const [loading, setLoading] = useState(false);

  const allowed = !permission
    || hasPermission(permission)
    || (fallbackPermission ? hasPermission(fallbackPermission) : false);

  const onClick = useCallback(() => {
    setLoading(true);
    // Defer one frame so the loading state paints before the synchronous build.
    requestAnimationFrame(() => {
      try {
        const result = build();
        if (!result.ok) {
          notify('Não foi possível gerar o PDF', { variant: 'error', description: result.message });
        }
      } catch (err) {
        notify('Falha ao gerar o relatório', {
          variant: 'error',
          description: err instanceof Error ? err.message : 'Erro inesperado ao montar o relatório.',
        });
      } finally {
        setLoading(false);
      }
    });
  }, [build, notify]);

  if (!allowed) return null;

  return (
    <HudButton
      variant={variant}
      size={size}
      isLoading={loading}
      leftIcon={<Download className="h-4 w-4" />}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? loadingLabel : label}
    </HudButton>
  );
}
