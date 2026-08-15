import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { FiscalSchemaMissingError } from './store';

export function fiscalApiError(error: unknown, fallback: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({
      ok: false,
      error: 'Dados fiscais inválidos.',
      fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 });
  }
  if (error instanceof FiscalSchemaMissingError) {
    return NextResponse.json({ ok: false, error: error.message, code: 'FISCAL_SCHEMA_MISSING' }, { status: 503 });
  }
  const message = error instanceof Error ? error.message : fallback;
  const status = /não encontrad|incompatível|inválid|não pertence|fora da vigência|não aprovado/i.test(message) ? 400 : 500;
  return NextResponse.json({ ok: false, error: message || fallback }, { status });
}

