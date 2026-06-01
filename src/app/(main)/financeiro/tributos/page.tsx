import { redirect } from 'next/navigation';

/**
 * Legacy orphan tax route. The tax module was consolidated into the
 * TaxObligation-backed page at /financeiro/impostos. Kept as a permanent
 * redirect so existing bookmarks/deep links keep working without duplicating
 * a second tax module.
 */
export default function TributosPage() {
  redirect('/financeiro/impostos');
}
