import { FiscalDocumentDetail } from '@/components/fiscal/FiscalDocumentDetail';

export default async function FiscalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FiscalDocumentDetail id={id} />;
}

