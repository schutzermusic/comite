import { FiscalDocuments } from '@/components/fiscal/FiscalDocuments';
import { InvoicesToIssuePanel } from '@/components/fiscal/InvoicesToIssuePanel';

/**
 * A fila de "NF A EMITIR" vem ANTES da lista de documentos.
 *
 * A lista responde "o que já emiti"; a fila responde "o que me autorizaram a
 * emitir e ainda não emiti". A segunda é trabalho, a primeira é acervo — e
 * acervo no topo faz o trabalho do dia desaparecer abaixo dele.
 */
export default function FiscalDocumentsPage() {
  return (
    <div className="space-y-4">
      <InvoicesToIssuePanel />
      <FiscalDocuments />
    </div>
  );
}
