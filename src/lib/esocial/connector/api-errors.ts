import { NextResponse } from 'next/server';
import { EsocialSchemaMissingError } from './store';

/**
 * Resposta de erro das rotas do eSocial.
 *
 * Toda rota do conector precisa responder JSON mesmo quando falha. Se uma
 * exceção escapa, o Next devolve uma página de erro em HTML e o cliente morre
 * com "Unexpected end of JSON input" — trocando a causa real (tipicamente a
 * migration não aplicada, ou o bucket ausente) por uma mensagem inútil.
 */
export function esocialErrorResponse(err: unknown, fallback: string): NextResponse {
  const schemaMissing = err instanceof EsocialSchemaMissingError;
  const message = err instanceof Error ? err.message : fallback;

  // Erros de infraestrutura previsíveis viram 503 (configure e tente de novo),
  // não 500 (algo quebrou) — a diferença muda o que o operador faz a seguir.
  const missingBucket = /bucket not found/i.test(message);
  const status = schemaMissing || missingBucket ? 503 : 500;

  if (missingBucket) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'O bucket "esocial-certificates" não existe neste projeto Supabase. ' +
          'Ele é criado pela migration 080_esocial_ingestion.sql — aplique-a antes de enviar o certificado.',
        schemaMissing: true,
      },
      { status },
    );
  }

  return NextResponse.json({ ok: false, error: message, schemaMissing }, { status });
}
