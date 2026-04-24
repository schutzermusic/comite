# TASK-003 · Background atmosférico + noise texture

**Fase:** F0 — Foundation
**PR:** PR-03
**Dependências:** TASK-001
**Pode rodar em paralelo com:** TASK-002
**Owner-profile:** Frontend Engineer
**Estimativa:** 3–4h

---

## Contexto

O background atual (`ImmersiveSpatialBackground`) é pesado e está acoplado ao Dashboard. Esta tarefa cria um background leve, atmosférico e reutilizável para todas as rotas internas — com canvas escuro, aurora suave em drift, grid isométrico com máscara e vinheta. O Dashboard mantém seu globo 3D acima do fundo.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Adicionar** | `public/textures/noise-16.png` |
| **Criar** | `src/components/system/AtmosphericBackground.tsx` |
| **Modificar** | `src/app/(main)/layout.tsx` |
| **Modificar** | `src/styles/tokens.css` (append animações) |

---

## Instruções

### Passo 1 — Gerar `public/textures/noise-16.png`

Criar via script Node ou usar imagem existente. O arquivo deve ser:
- **16×16 px**, monocromático (cinza), sem transparência.
- Cada pixel tem valor de luminância aleatório entre 110 e 146 (RGB igual em todos os canais).
- Exportar como PNG opaco, ≤ 8 KB.

Script de geração (executar uma vez):
```js
// scripts/generate-noise.mjs
import { createCanvas } from 'canvas';
import { writeFileSync } from 'fs';
const c = createCanvas(16, 16);
const ctx = c.getContext('2d');
const img = ctx.createImageData(16, 16);
for (let i = 0; i < img.data.length; i += 4) {
  const v = 110 + Math.floor(Math.random() * 36);
  img.data[i] = img.data[i+1] = img.data[i+2] = v;
  img.data[i+3] = 255;
}
ctx.putImageData(img, 0, 0);
writeFileSync('public/textures/noise-16.png', c.toBuffer('image/png'));
console.log('noise-16.png gerado');
```

> Se `canvas` npm não estiver disponível, use qualquer imagem 16×16 de ruído cinza.

### Passo 2 — Adicionar animações em `src/styles/tokens.css`

Append no final:
```css
/* ── Aurora atmosférica ── */
.ig-aurora {
  background:
    radial-gradient(ellipse 40% 30% at 20% 30%, rgba(20,184,166,0.06), transparent 60%),
    radial-gradient(ellipse 35% 25% at 80% 70%, rgba(59,130,246,0.05), transparent 60%);
  animation: ig-aurora-drift 48s ease-in-out infinite alternate;
  filter: blur(40px);
}
html.light .ig-aurora {
  background:
    radial-gradient(ellipse 40% 30% at 20% 30%, rgba(15,118,110,0.05), transparent 60%),
    radial-gradient(ellipse 35% 25% at 80% 70%, rgba(29,78,216,0.04), transparent 60%);
}
@keyframes ig-aurora-drift {
  0%   { transform: translate3d(0, 0, 0) scale(1);     opacity: 0.9; }
  50%  { transform: translate3d(3%, -2%, 0) scale(1.05); opacity: 1;   }
  100% { transform: translate3d(-2%, 2%, 0) scale(1.02); opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .ig-aurora { animation: none; }
}
```

### Passo 3 — Criar `src/components/system/AtmosphericBackground.tsx`

```tsx
"use client";

export function AtmosphericBackground() {
  return (
    <>
      {/* Plano 0: canvas escuro */}
      <div className="fixed inset-0 -z-30 bg-ig-canvas" />

      {/* Plano 1: halo teal no topo */}
      <div
        className="fixed inset-0 -z-29 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 90% 60% at 50% 0%, rgba(20,184,166,0.07), transparent 60%)',
        }}
      />

      {/* Plano 2: grid isométrico com máscara */}
      <div
        className="fixed inset-0 -z-28 pointer-events-none opacity-[0.35]"
        style={{
          backgroundImage: `
            linear-gradient(to right,  rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)
          `,
          backgroundSize: '48px 48px',
          maskImage:
            'radial-gradient(ellipse 80% 100% at 50% 40%, #000 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 100% at 50% 40%, #000 0%, transparent 75%)',
        }}
      />

      {/* Plano 3: aurora em drift */}
      <div className="fixed inset-0 -z-27 pointer-events-none ig-aurora" />

      {/* Plano 4: vinheta inferior */}
      <div
        className="fixed inset-0 -z-26 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 50% 100%, rgba(0,0,0,0.55), transparent 70%)',
        }}
      />
    </>
  );
}
```

### Passo 4 — Modificar `src/app/(main)/layout.tsx`

Substituir `<ImmersiveSpatialBackground>` (ou qualquer import de background legado) por `<AtmosphericBackground>`.

```tsx
// Antes (remover):
import { ImmersiveSpatialBackground } from '@/components/system/ImmersiveSpatialBackground';
// ...
<ImmersiveSpatialBackground />

// Depois (adicionar):
import { AtmosphericBackground } from '@/components/system/AtmosphericBackground';
// ...
<AtmosphericBackground />
```

> O Dashboard mantém o globo 3D em `z-index` próprio — o background atmosférico fica atrás e é invisível sob o globo.

---

## Acceptance criteria

- [ ] Dashboard ainda mostra o globo sem quebrar.
- [ ] Páginas `/projetos`, `/financeiro`, `/riscos` mostram grid sutil + aurora em drift.
- [ ] `prefers-reduced-motion: reduce` desliga a animação.
- [ ] Em light mode, aurora usa cores teal/azul atenuadas (não aparece branca).
- [ ] FPS ≥ 55 com 6+ painéis em tela (testar com DevTools Performance em `/financeiro`).
- [ ] `npm run build` passa.
