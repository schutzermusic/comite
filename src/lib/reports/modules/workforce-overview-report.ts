/**
 * Ponto de entrada do relatório de Pessoas & Custos no registry de reports.
 *
 * A implementação vive em `@/lib/workforce/overview/report/pdf`: este material é
 * de cockpit executivo/board e usa documento próprio, com tema escuro e claro,
 * não o shell claro genérico compartilhado pelas demais telas.
 *
 * O documento é montado a partir do mesmo `WorkforceOverviewModel` que alimenta
 * a tela — é isso que impede o relatório de divergir do que o usuário viu.
 */

export {
  buildWorkforceOverviewPdfHtml,
  openWorkforceOverviewPdf,
  type WorkforceOverviewPdfOptions,
} from '@/lib/workforce/overview/report/pdf';
