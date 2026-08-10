/* Medidor temporário: transbordo e colisão de texto nas páginas do PDF Apex. */
import path from 'node:path';
import { chromium } from '@playwright/test';

const file = process.argv[2] || '.preview/pdf.html';
const shots = process.argv.slice(3).map(Number);
const url = `file://${path.resolve(file)}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(url, { waitUntil: 'load' });

const report = await page.evaluate(() => {
  const pages = [...document.querySelectorAll('.page')];
  const rects = (root) => [...root.querySelectorAll('h1,h2,.sec-sub,.copy,.cell-l,.cell-v,.cell-h,.cell-d,.read em,.read strong,.apex-lg,.panel-cap,.agenda b,.agenda span,td,th,.dial-label,.dial-note,.pfoot span')]
    .filter((el) => el.textContent.trim())
    .map((el) => ({ t: el.textContent.trim().slice(0, 28), r: el.getBoundingClientRect(), el }));
  return pages.map((p, i) => {
    const overflow = p.scrollHeight - p.clientHeight;
    const items = rects(p);
    const collisions = [];
    for (let a = 0; a < items.length; a++) {
      for (let b = a + 1; b < items.length; b++) {
        const A = items[a], B = items[b];
        if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
        const overlapX = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
        const overlapY = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
        if (overlapX > 1.5 && overlapY > 1.5) collisions.push(`${A.t} ⟂ ${B.t}`);
      }
    }
    const box = p.getBoundingClientRect();
    const outside = items
      .filter((it) => it.r.bottom > box.bottom + 1 || it.r.right > box.right + 1 || it.r.left < box.left - 1)
      .map((it) => it.t);
    const eyebrow = p.querySelector('.eyebrow')?.textContent.trim() || 'capa/fecho';
    return { page: i + 1, eyebrow, overflow, collisions: collisions.slice(0, 6), outside: outside.slice(0, 6) };
  });
});

for (const r of report) {
  const flags = [];
  if (r.overflow > 2) flags.push(`OVERFLOW +${r.overflow}px`);
  if (r.collisions.length) flags.push(`COLISÃO: ${r.collisions.join(' | ')}`);
  if (r.outside.length) flags.push(`FORA: ${r.outside.join(' | ')}`);
  console.log(`${String(r.page).padStart(2, '0')} ${r.eyebrow.padEnd(28)} ${flags.length ? flags.join(' ; ') : 'ok'}`);
}

for (const n of shots) {
  const el = page.locator('.page').nth(n - 1);
  await el.screenshot({ path: `.preview/page-${String(n).padStart(2, '0')}.png` });
  console.log(`shot .preview/page-${String(n).padStart(2, '0')}.png`);
}

await browser.close();
