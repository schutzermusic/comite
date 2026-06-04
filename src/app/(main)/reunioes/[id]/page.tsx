import { redirect } from 'next/navigation';

/**
 * Legacy meeting detail route. The detail view is now a drawer on the Agenda
 * hub; this route deep-links into it so old links keep working.
 */
export default async function ReuniaoDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/reunioes?event=${id}`);
}
