/**
 * O NOME de quem responde por uma oportunidade, proposta ou acompanhamento.
 *
 * ─── Por que isto não é uma consulta comum a `profiles` ──────────────────
 *
 * A policy `profiles_select_scoped` (migration 005) deixa uma pessoa ler o
 * próprio perfil e, fora isso, só quem administra usuários ou vê o painel
 * executivo lê os perfis dos colegas. É a regra certa para um diretório de
 * pessoas — e é a regra errada para um CRM, onde "de quem é esta
 * oportunidade?" faz parte do registro que a pessoa já tem permissão de ver.
 *
 * A saída NÃO é afrouxar a policy. É esta função: o servidor resolve os nomes
 * pelo service role, mas só dos ids que JÁ APARECEM nas linhas que o chamador
 * acabou de ler sob RLS, e só dentro da organização ativa. Nada além do nome
 * atravessa — nem e-mail, nem telefone, nem cargo, nem a lista de quem existe.
 *
 * Em outras palavras: quem pode ver a oportunidade pode ver o nome do dono
 * dela. Quem não pode ver a oportunidade continua sem poder perguntar nada.
 */
if (typeof window !== 'undefined') {
  throw new Error('owner-directory.ts não pode ser importado no navegador');
}

import { platformServiceClient } from '@/lib/platform/server-client';

export type OwnerDirectory = Record<string, string>;

export async function resolveOwnerNames(
  organizationId: string,
  userIds: Array<string | null | undefined>,
): Promise<OwnerDirectory> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return {};

  const { data, error } = await platformServiceClient()
    .from('profiles')
    .select('user_id,full_name')
    .eq('organization_id', organizationId)
    .in('user_id', ids);

  // Um diretório indisponível não pode derrubar a tela: sem nome, a interface
  // mostra "Responsável não identificado", que é verdade — e é melhor do que
  // um erro que esconde o pipeline inteiro.
  if (error || !data) return {};

  const directory: OwnerDirectory = {};
  for (const row of data as Array<{ user_id: string; full_name: string | null }>) {
    if (row.full_name?.trim()) directory[row.user_id] = row.full_name.trim();
  }
  return directory;
}
