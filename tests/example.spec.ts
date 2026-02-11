import { test, expect } from '@playwright/test';

test('exemplo de teste', async ({ page }) => {
  await page.goto('/');
  
  // Verifica se a página carregou corretamente
  await expect(page).toHaveTitle(/Insight Energy/i);
  
  // Exemplo: verifica se o dashboard está visível
  // await expect(page.locator('text=Dashboard')).toBeVisible();
});


