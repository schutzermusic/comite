'use client';

/**
 * Saídas de apresentação do cockpit: PDF, apresentação HTML e PowerPoint.
 *
 * Fecha três lacunas do botão anterior, que era um `HudButton` cru chamando
 * `openWorkforceReport(workforce)` e jogando o retorno fora:
 *
 *   • sem RBAC — o registry exige `people.view_costs` e ninguém verificava;
 *   • sem estado de carregamento durante a montagem síncrona do HTML;
 *   • sem tratamento de popup bloqueado: o export falhava em silêncio, e o
 *     usuário concluía que o botão não funcionava.
 *
 * `ExportReportButton` já resolve os três para o PDF; os outros dois destinos
 * seguem o mesmo contrato de permissão e de aviso.
 */

import { useCallback, useState } from 'react';
import { FileText, Presentation } from 'lucide-react';
import { HudButton } from '@/components/hud';
import { ExportReportButton } from '@/components/reports/ExportReportButton';
import { useHudToast } from '@/hooks/useHudToast';
import { usePermissions } from '@/hooks/use-permissions';
import type { ReportExportResult } from '@/lib/reports/report-types';

export const WORKFORCE_EXPORT_PERMISSION = 'people.view_costs';
export const WORKFORCE_EXPORT_FALLBACK_PERMISSION = 'people.cost_view';

interface WorkforceExportMenuProps {
  /** Fecha sobre o modelo atual — o documento reflete sempre o que está na tela. */
  buildPdf: () => ReportExportResult;
  /** Monta o deck HTML autocontido. Ausente enquanto o destino não existe. */
  buildPresentation?: () => string;
  onPresent?: (html: string) => void;
  /** Baixa o .pptx. Ausente enquanto o destino não existe. */
  downloadPptx?: () => Promise<void>;
  /**
   * Sem competência apurada não há documento a gerar. Exportar um relatório
   * vazio é pior que não exportar: ele circula, e quem o recebe não sabe que
   * está lendo ausência de dado em vez de dado.
   */
  disabled?: boolean;
  disabledReason?: string;
}

export function WorkforceExportMenu({
  buildPdf,
  buildPresentation,
  onPresent,
  downloadPptx,
  disabled = false,
  disabledReason = 'Sem competência apurada no período',
}: WorkforceExportMenuProps) {
  const { hasPermission } = usePermissions();
  const { notify } = useHudToast();
  const [pptxLoading, setPptxLoading] = useState(false);

  const allowed =
    hasPermission(WORKFORCE_EXPORT_PERMISSION) ||
    hasPermission(WORKFORCE_EXPORT_FALLBACK_PERMISSION);

  const present = useCallback(() => {
    if (!buildPresentation || !onPresent) return;
    try {
      onPresent(buildPresentation());
    } catch (err) {
      notify('Falha ao montar a apresentação', {
        variant: 'error',
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      });
    }
  }, [buildPresentation, onPresent, notify]);

  const exportPptx = useCallback(async () => {
    if (!downloadPptx) return;
    setPptxLoading(true);
    try {
      await downloadPptx();
    } catch (err) {
      notify('Falha ao gerar o PowerPoint', {
        variant: 'error',
        description: err instanceof Error ? err.message : 'Erro inesperado.',
      });
    } finally {
      setPptxLoading(false);
    }
  }, [downloadPptx, notify]);

  if (!allowed) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      title={disabled ? disabledReason : undefined}
    >
      {disabled ? (
        <HudButton variant="glass" size="sm" disabled>
          Exportar PDF
        </HudButton>
      ) : (
        <ExportReportButton
          build={buildPdf}
          permission={WORKFORCE_EXPORT_PERMISSION}
          fallbackPermission={WORKFORCE_EXPORT_FALLBACK_PERMISSION}
          size="sm"
        />
      )}

      {buildPresentation && onPresent && (
        <HudButton
          variant="glass"
          size="sm"
          disabled={disabled}
          leftIcon={<Presentation className="h-4 w-4" />}
          onClick={present}
        >
          Apresentação
        </HudButton>
      )}

      {downloadPptx && (
        <HudButton
          variant="glass"
          size="sm"
          disabled={disabled || pptxLoading}
          isLoading={pptxLoading}
          leftIcon={<FileText className="h-4 w-4" />}
          onClick={() => void exportPptx()}
        >
          PowerPoint
        </HudButton>
      )}
    </div>
  );
}
