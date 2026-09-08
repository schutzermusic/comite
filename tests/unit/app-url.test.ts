import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PRODUCTION_ORIGIN,
  getCanonicalRedirectUrl,
  getPublicAppOrigin,
} from '../../src/lib/config/app-url';

describe('canonical application URL', () => {
  it.each(['board.insightapex.co', 'www.insightapex.co'])(
    'redirects %s while preserving path and query',
    (host) => {
      const result = getCanonicalRedirectUrl(
        new URL(`http://${host}/contratos/123?tab=financeiro&from=email`),
      );

      expect(result?.toString()).toBe(
        `${CANONICAL_PRODUCTION_ORIGIN}/contratos/123?tab=financeiro&from=email`,
      );
    },
  );

  it.each([
    'https://insightapex.co/projetos',
    'http://localhost:9002/projetos',
    'https://staging.insightapex.co/projetos',
    'https://ponto.insightapex.co/login',
  ])('does not canonicalize supported host %s', (url) => {
    expect(getCanonicalRedirectUrl(new URL(url))).toBeNull();
  });

  it('normalizes a legacy configured origin for generated links', () => {
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://board.insightapex.co';
    try {
      expect(getPublicAppOrigin('http://localhost:9002')).toBe(CANONICAL_PRODUCTION_ORIGIN);
    } finally {
      if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  });
});
