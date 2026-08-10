'use client';

/**
 * Portal de Ponto Web — login do colaborador (ponto.insightapex.co/login).
 * Alternativa para quem não consegue instalar o app: mesma conta Supabase,
 * mesma tela simplificada do app de campo. Após autenticar vai direto a
 * /ponto (não ao dashboard executivo).
 */

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, TriangleAlert } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { InsightLogo } from '@/components/layout/insight-logo';
import { PontoButton } from '@/components/ponto';

const FIELD_CLASS =
  'min-h-[52px] w-full rounded-[var(--ig-radius-md)] border border-ig-border-strong bg-ig-raised px-4 py-3 text-ig-body text-ig-fg-strong placeholder:text-ig-fg-subtle focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]';

export default function PontoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(
        /invalid/i.test(signInError.message)
          ? 'E-mail ou senha incorretos.'
          : /network|fetch|failed/i.test(signInError.message)
            ? 'Sem conexão com o servidor. Verifique sua internet e tente de novo.'
            : signInError.message,
      );
      setLoading(false);
      return;
    }
    router.replace('/ponto');
  }

  return (
    <main
      data-ponto-theme
      data-ponto-canvas
      className="flex min-h-[100dvh] items-center justify-center bg-ig-canvas px-5 py-10"
    >
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <InsightLogo width={196} height={25} animated={false} priority alt="Insight Energy" />
          <h1 className="mt-4 flex items-center gap-2 text-ig-display text-ig-fg-strong">
            <Clock className="h-6 w-6 shrink-0 text-ig-accent" aria-hidden="true" />
            Ponto
          </h1>
          <p className="mt-1.5 text-ig-body-sm text-ig-fg-muted">
            Registre sua jornada pelo navegador — sem instalar nada.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="ponto-email" className="block text-ig-body-sm font-semibold text-ig-fg-strong">
              E-mail
            </label>
            <input
              id="ponto-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              placeholder="seu.nome@empresa.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ponto-senha" className="block text-ig-body-sm font-semibold text-ig-fg-strong">
              Senha
            </label>
            <input
              id="ponto-senha"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Sua senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-[var(--ig-radius-sm)] bg-[color-mix(in_oklab,var(--ig-danger)_12%,transparent)] px-3 py-2.5 text-ig-body-sm text-ig-danger"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}

          <PontoButton type="submit" variant="primary" loading={loading} className="mt-1">
            {loading ? 'Entrando…' : 'Entrar'}
          </PontoButton>
        </form>

        <p className="mt-6 text-center text-ig-caption text-ig-fg-subtle">
          Mesmo login do Insight Apex. Problemas de acesso? Fale com o RH.
        </p>
      </div>
    </main>
  );
}
