'use client';

/**
 * Rede de segurança para links de convite/ativação do Supabase.
 *
 * Quando a URL de `redirect_to` não está na allowlist do projeto (Auth → URL
 * Configuration → Redirect URLs), o Supabase IGNORA o destino e joga o usuário
 * na Site URL — a raiz do app — com os tokens no fragmento (#access_token=…).
 * A raiz redireciona para /dashboard → /login, e o colaborador nunca vê a tela
 * de criar senha (foi exatamente o sintoma do convite de Ponto).
 *
 * Este componente roda em toda página: se encontrar um fragmento de auth numa
 * rota que NÃO sabe tratá-lo, encaminha para a página certa preservando o hash
 * — /ponto/ativar quando o token é de um colaborador de Ponto (metadata
 * ponto_person_id) e /welcome nos demais convites.
 *
 * Não é substituto da allowlist: é o que impede um erro de configuração de
 * virar um convite quebrado.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Rotas que já consomem o hash/`?code=` por conta própria. */
const HASH_AWARE_ROUTES = ['/welcome', '/ponto/ativar', '/auth', '/reset-password'];

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** /ponto/ativar quando o token pertence a um colaborador de Ponto. */
function activationTargetFor(accessToken: string | null): string {
  if (!accessToken) return '/welcome';
  const payload = decodeJwtPayload(accessToken);
  const meta = (payload?.user_metadata ?? {}) as Record<string, unknown>;
  return meta.ponto_person_id ? '/ponto/ativar' : '/welcome';
}

export function AuthHashRouter() {
  const pathname = usePathname();

  useEffect(() => {
    if (HASH_AWARE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return;

    const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    if (!rawHash) return;

    const params = new URLSearchParams(rawHash);
    const accessToken = params.get('access_token');
    const type = params.get('type');
    const hasError = Boolean(params.get('error') || params.get('error_code'));
    // Só reagimos a fragmentos de auth — qualquer outra âncora da página passa.
    const isAuthFragment = Boolean(accessToken) || (hasError && Boolean(type)) || type === 'recovery' || type === 'invite';
    if (!isAuthFragment) return;

    const target = activationTargetFor(accessToken);
    // location.replace (e não router) para o hash chegar intacto ao destino,
    // sem deixar a rota quebrada no histórico do navegador.
    window.location.replace(`${target}#${rawHash}`);
  }, [pathname]);

  return null;
}
