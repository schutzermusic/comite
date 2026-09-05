# UI Architecture Gate — segunda passagem

## Diagnóstico de causa raiz

O problema não é densidade nem espaçamento. É que **um único material
representa todos os níveis de hierarquia**, e que **no modo claro a escada de
superfícies é plana**.

### 1. Um componente de superfície para todos os níveis

`HudPanel` — um material de vidro com cinco camadas (tint + blur, edge
lighting, specular, noise, sweep) — é o que desenha:

- a moldura da tela inteira;
- cada seção dentro dela;
- cada grupo dentro da seção;
- cada métrica dentro do grupo.

Como o material é o mesmo em todos os níveis, aninhar não produz hierarquia:
produz mais cromo. Um painel dentro de um painel dentro de um painel lê como
três caixas irmãs, não como continente e conteúdo. É a mesma razão pela qual a
navegação da carteira e a navegação do dossiê se confundem — ambas são
`HudTabs` horizontal, então a barra que troca de MÓDULO e a barra que troca de
SEÇÃO DE UM CONTRATO têm exatamente a mesma linguagem.

### 2. No claro, os níveis 1 a 3 são a mesma cor

```
html.light {
  --ig-bg-canvas:  #F7F8FA;
  --ig-bg-base:    #FFFFFF;   ← nível 1
  --ig-bg-raised:  #FFFFFF;   ← nível 2   idênticos
  --ig-bg-overlay: #FFFFFF;   ← nível 3
  --ig-bg-panel:   #FFFFFF;   ←
}
```

Quatro tokens de superfície, uma cor só. No escuro a escada existe de verdade
(`#07090C → #0B0F14 → #10161D → #141B24`) e a hierarquia se lê sozinha; no
claro não existe degrau nenhum, então a única separação possível vinha de
sombra e do gradiente do vidro. Some a sombra e some a hierarquia — que é
exatamente o teste do §15.

As bordas do claro agravam: `--ig-border-subtle` a 4% e `--ig-border-default`
a 8% de opacidade são praticamente invisíveis sobre branco, então nem a borda
sustentava a separação sozinha.

## Modelo novo

### Escada de superfícies (§3)

| Nível | Papel | Como se separa | Sombra |
|---|---|---|---|
| L0 | Canvas da aplicação | cor de fundo | não |
| L1 | Superfície de trabalho | contraste com o canvas + borda 1px | não |
| L2 | Seção / grupo | borda 1px + tinta muito leve | não |
| L3 | Linha interativa | divisor + hover | não |
| — | Modal, drawer, popover, menu | elevação real | **sim** |

Sombra passa a significar uma coisa só: *isto flutua sobre o resto*. Conteúdo
estático nunca flutua.

### Hierarquia de navegação (§1)

Quatro níveis, quatro linguagens distintas:

```
APLICAÇÃO      sidebar global, vertical, full-height      (já existia)
MÓDULO         abas horizontais da carteira               (mantido)
CONTRATO       cabeçalho do dossiê + breadcrumb           (reforçado)
SEÇÃO          rail vertical local dentro do dossiê       (novo)
```

O rail é local ao workspace do contrato: não é uma segunda sidebar
full-height, é secundário à sidebar global, e some para um seletor compacto
abaixo de `lg`.

### Anatomia única de seção (§6)

`SectionHeader` — título, apoio opcional, ação opcional à direita — sem
moldura própria. Uma seção é um cabeçalho mais o conteúdo, não um cartão.

### Linha operacional (§7)

Obrigações, documentos, faturamento, aprovações, riscos, cláusulas e
renovações são listas: contêiner único dividido, trilho tonal para severidade,
colunas alinhadas entre linhas.
