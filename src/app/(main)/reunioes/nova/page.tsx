import { redirect } from 'next/navigation';

/**
 * Legacy "Nova Reunião" route. The creation flow now lives in a modal on the
 * Agenda hub; this route deep-links into it so old links keep working.
 */
export default function NovaReuniaoRedirect() {
  redirect('/reunioes?new=meeting');
}
