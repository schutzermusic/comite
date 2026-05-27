'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import { HudButton, HudInput, HudPanel } from '@/components/hud';
import { createClient } from '@/utils/supabase/client';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email, { redirectTo });

    if (resetError) {
      setError(resetError.message);
    } else {
      setMessage('Enviamos as instrucoes de recuperacao para o email informado.');
    }

    setLoading(false);
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-ig-bg-canvas p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--ig-info)_18%,transparent),transparent_42%)]" />
      <HudPanel elevation={4} className="relative z-10 w-full max-w-md">
        <div className="mb-7">
          <h1 className="text-xl font-semibold text-ig-fg-strong">Recuperar senha</h1>
          <p className="mt-1 text-sm text-ig-fg-muted">Informe o email cadastrado para receber o link de redefinicao.</p>
        </div>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <HudInput label="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          {error && <p className="text-sm text-ig-danger">{error}</p>}
          {message && <p className="text-sm text-ig-success">{message}</p>}
          <HudButton type="submit" variant="primary" fullWidth isLoading={loading} leftIcon={<Mail className="h-4 w-4" />}>
            Enviar link
          </HudButton>
        </form>
        <Link href="/login" className="mt-5 block text-sm text-ig-accent hover:underline">
          Voltar ao login
        </Link>
      </HudPanel>
    </main>
  );
}
