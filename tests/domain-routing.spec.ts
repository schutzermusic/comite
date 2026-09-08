import { expect, test } from '@playwright/test';

test('preserves a protected deep link through the login redirect', async ({ page }) => {
  await page.goto('/contratos/123?tab=financeiro&from=email');

  await expect(page).toHaveURL((url) => {
    return url.pathname === '/login'
      && url.searchParams.get('next') === '/contratos/123?tab=financeiro&from=email';
  });
});

for (const host of ['board.insightapex.co', 'www.insightapex.co']) {
  test(`permanently redirects ${host} to the apex with path and query intact`, async ({ request }) => {
    const response = await request.get('/projetos?view=planejamento&from=email', {
      headers: { host },
      maxRedirects: 0,
    });

    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(
      'https://insightapex.co/projetos?view=planejamento&from=email',
    );
  });
}
