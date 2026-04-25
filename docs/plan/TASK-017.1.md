# TASK-017.1 · Consolidar API serial/watermark no Dashboard HudPanel

**Fase:** F5 — Identidade + Polish (corretiva)
**PR:** PR-17.1
**Dependências:** TASK-017 (commit `de84f08`)
**Owner-profile:** Design System Engineer
**Estimativa:** 1h

---

## Origem

Sub-task corretiva de TASK-017. O reporte final identificou que o Dashboard usa um
`HudPanel` distinto (`src/components/dashboard/hud/HudPanel.tsx`) que não suportava
as props `serial` e `watermark` introduzidas em TASK-017. A solução adotada à época
foi adicionar elementos inline (`<span>` soltos) ao final de `LeftHudStack` e
`RightHudStack`, criando inconsistência de implementação com o restante do produto
e divergindo do padrão do `HudPanel` oficial.

TASK-018 (Parallax + specular sweep + focus cinemático) depende de `HudPanel` v2 e
vai aplicar efeitos cinemáticos nos painéis. Manter dois `HudPanel` divergentes
duplicaria o trabalho e geraria inconsistência visual no Dashboard — a tela mais
visível do produto.

## Decisão

**Estender** o Dashboard `HudPanel` para aceitar `serial` e `watermark`, em vez de
deprecá-lo (deprecação fica para TASK-021). Razões:

- Custo de estender = ~10 linhas de código, retrocompatível.
- API torna-se simétrica entre o `HudPanel` oficial e o do Dashboard, simplificando
  TASK-018.
- Evita refactor amplo de `LeftHudStack`/`RightHudStack` agora — eles continuam
  consumindo o `HudPanel` local com o mesmo shape de antes, apenas duas props
  novas.

## Escopo de arquivos

| Ação | Arquivo |
|---|---|
| **Modificar** | `src/components/dashboard/hud/HudPanel.tsx` (estender API) |
| **Modificar** | `src/components/dashboard/LeftHudStack.tsx` (migrar inline → props) |
| **Modificar** | `src/components/dashboard/RightHudStack.tsx` (migrar inline → props) |
| **Criar** | `docs/plan/TASK-017.1.md` (este arquivo) |

Fora de escopo: `src/components/hud/HudPanel.tsx` (já estável e em produção),
qualquer alteração de API pública do Dashboard `HudPanel` para além de `serial` e
`watermark`.

## Implementação

### `src/components/dashboard/hud/HudPanel.tsx`

- Adicionar props opcionais `serial?: string` e `watermark?: string` à
  `HudPanelProps`.
- Renderizar rodapé `<footer>` apenas se ao menos uma das duas estiver definida.
- Tipografia idêntica ao rodapé do `HudPanel` oficial:
  - serial: `font-mono text-[10px] tracking-[0.2em] text-ig-fg-subtle`
  - watermark: `text-[9px] uppercase tracking-[0.32em] text-ig-fg-subtle`
  - separador: `border-t border-ig-border-subtle`
- Padding ajustado à escala compacta do Dashboard (`px-3.5`) em vez de `px-5`,
  para consistência com o resto do componente.

### `LeftHudStack.tsx` / `RightHudStack.tsx`

- Remover os elementos inline criados em TASK-017
  (`HUD-2026`, `CONTROL ROOM · V2.6`, `EXECUTIVE · VIEW`).
- Passar via props no último `<HudPanel>` de cada stack:
  - LeftHudStack: `serial="HUD-2026"` + `watermark="CONTROL ROOM · V2.6"` no painel
    `financeSnapshot` (Panel C).
  - RightHudStack: `watermark="EXECUTIVE · VIEW"` no painel `eventStream`
    (Panel F).

## Acceptance criteria

- [ ] `src/components/dashboard/hud/HudPanel.tsx` aceita props `serial` e
  `watermark`.
- [ ] Quando ambas `undefined`, NENHUM nó extra é renderizado (zero impacto em
  painéis sem identidade).
- [ ] Rodapé visual idêntico, em tipografia, ao rodapé do `HudPanel` oficial
  (`font-mono`, `tracking-[0.2em]`, `text-ig-fg-subtle`).
- [ ] `LeftHudStack` e `RightHudStack` não contêm mais textos `serial`/`watermark`
  inline — tudo via props.
- [ ] `npm run typecheck`: 59 erros (sem regressão vs. baseline TASK-017).
- [ ] `npm run build`: ✅
- [ ] Nenhum hit novo de
  `text-white|bg-white/\[|border-white/\[|text-black|text-cyan-|text-emerald-|from-cyan.*to-emerald`
  nos arquivos tocados.
- [ ] `prefers-reduced-motion`: N/A (sem nova animação).
- [ ] A11y: contraste do rodapé verificado em dark e light no Dashboard.
