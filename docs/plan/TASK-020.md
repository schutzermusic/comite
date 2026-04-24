# TASK-020 · Performance guardrails

**Fase:** F5 — Identidade + Polish
**PR:** PR-20
**Dependências:** TASK-018
**Owner-profile:** Frontend Engineer
**Estimativa:** 3–4h

---

## Contexto

Com 5 elevações de vidro e múltiplas animações, é essencial garantir que o produto mantenha performance acima de 55 FPS em navegadores modernos e degradação graciosa em dispositivos de baixa resolução e Safari iPad.

---

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/styles/glass.css` (adicionar guardrails) |
| **Auditoria** | Lighthouse em Dashboard, Financeiro, Projetos, Reuniões |
| **Teste** | 3 dispositivos: macOS, iPad Safari, Android Chrome |

---

## Adicionar em `glass.css`

Append no final:

```css
/* ═════════════════════════════════════════════════════════
   PERFORMANCE GUARDRAILS
   ═════════════════════════════════════════════════════════ */

/* contain já está no base .ig-glass — verificar se está presente */
.ig-glass {
  contain: layout style paint;
}

/* will-change apenas durante hover (reset no mouseLeave via CSS) */
.ig-glass[data-interactive]:hover {
  will-change: transform, box-shadow;
}

/* Reduzir backdrop-filter em dispositivos de baixa DPI + touch */
@media (max-resolution: 1.5dppx) and (pointer: coarse) {
  .ig-glass[data-elev="1"]::before {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--ig-bg-panel);
  }
  .ig-glass[data-elev="2"]::before {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
}

/* Desligar tudo com prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .ig-glass,
  .ig-aurora,
  .ig-glass > [data-ig-sweep],
  .ig-glass[data-interactive] > [data-ig-content] {
    animation: none !important;
    transition: none !important;
  }
}
```

---

## Auditoria Lighthouse

Rodar em modo **production** (ou `next build && next start`) com DevTools desabilitado:

```bash
npm run build && npm run start
# Em outra aba: lighthouse http://localhost:3000/dashboard --output=json --output-path=lighthouse-dashboard.json
```

Rotas a auditar:
- `/dashboard`
- `/financeiro`
- `/projetos`
- `/reunioes`

Alvos:
| Métrica | Alvo |
|---|---|
| Performance | ≥ 75 |
| Accessibility | ≥ 90 |
| Best Practices | ≥ 90 |

---

## Checklist de testes manuais

### macOS (Chrome/Safari)
- [ ] 6 `HudPanel` em tela: FPS ≥ 55 (DevTools Performance recording 5s).
- [ ] Scroll suave em `/projetos` com 20+ linhas na tabela.
- [ ] Hover em painel `elevation={5}` sem jank.

### iPad Safari
- [ ] Painéis renderizam sem flicker de `backdrop-filter`.
- [ ] Nenhum painel branco / flash ao navegar entre rotas.
- [ ] Aurora pausa quando `prefers-reduced-motion`.

### Android Chrome
- [ ] `blur(20px)` cai para `blur(12px)` (via media query `max-resolution`).
- [ ] Botões responsivos ao toque.

---

## Acceptance criteria

- [ ] `contain: layout style paint` declarado em `.ig-glass`.
- [ ] Media query de degradação mobile presente.
- [ ] `prefers-reduced-motion` desliga animações E transições.
- [ ] Lighthouse Performance ≥ 75 nas 4 rotas em build de produção.
- [ ] Nenhum `will-change` permanente (só em `hover`).
- [ ] `npm run build` passa.
