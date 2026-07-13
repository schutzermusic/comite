import { createClient } from '@/utils/supabase/client';

type CommitteeMemberRow = { committees: { key: string } | null };

/**
 * Keys dos comitês (tabela `committees`) aos quais o usuário autenticado
 * pertence. A RLS de `committee_members` sempre permite ler as próprias linhas
 * (`user_id = auth.uid()`), e `committees` é legível por qualquer membro da
 * organização — então esta consulta não exige permissões extras.
 *
 * Retorna `[]` quando não há sessão, o Supabase falha ou o usuário não está
 * vinculado a nenhum comitê.
 */
export async function getMyCommitteeKeys(): Promise<string[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('committee_members')
    .select('committees(key)')
    .eq('user_id', user.id)
    .returns<CommitteeMemberRow[]>();

  if (error) return [];
  return (data ?? [])
    .map((row) => row.committees?.key)
    .filter((key): key is string => Boolean(key));
}
