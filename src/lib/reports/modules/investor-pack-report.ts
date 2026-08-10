/**
 * Ponto de entrada do relatório da Projeção Financeira no registry de reports.
 *
 * A implementação vive em `@/lib/finance/investor-pack/apex-pdf`: este módulo é
 * material de investidor/board e usa o documento dark premium próprio (Apex),
 * não o shell claro genérico compartilhado pelas demais telas do Financeiro.
 * A API pública é mantida aqui para os consumidores existentes (página de
 * Projeção Financeira, Pack do Investidor e o script de QA de exports).
 */

export { buildInvestorPackPdfHtml, openInvestorPackPdf } from '@/lib/finance/investor-pack/apex-pdf';
