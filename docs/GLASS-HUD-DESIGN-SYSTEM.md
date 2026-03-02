# Glass HUD Design System

## Visão Geral

Sistema de design unificado "Glass HUD" para aplicação SaaS de Governança Corporativa, inspirado no estilo "Control Room" do dashboard. Todas as páginas e componentes agora seguem uma identidade visual consistente de vidro fosco escuro (deep glass) com acentos em teal/cyan.

## Princípios de Design

1. **Deep Glass**: Painéis semi-transparentes com backdrop-blur 24px e saturate 140%
2. **Double Border**: Bordas sutis duplas (1px outer + 1px inner) para profundidade
3. **Top Highlight**: Gradiente sutil no topo dos painéis
4. **Restrained Glow**: Brilhos neon contidos apenas para estados ativos/críticos
5. **Typography HUD**: Labels em uppercase com tracking amplo, números em tabular-nums

## Tokens de Design

### Cores

#### Background
- `--bg-primary`: `#0a0f0d` - Fundo principal
- `--bg-panel`: `rgba(8,28,22,0.48)` - Painéis de vidro
- `--bg-elevated`: `rgba(6,22,18,0.40)` - Elementos elevados

#### Bordas
- `--border-subtle`: `rgba(200,220,235,0.09)` - Bordas padrão
- `--border-hover`: `rgba(120,210,220,0.16)` - Hover state
- `--border-highlight`: `rgba(255,255,255,0.12)` - Destaque superior

#### Acentos
- **Teal/Cyan** (primário): `#14B8A6` / `#06B6D4`
- **Emerald** (sucesso): `#10B981`
- **Amber** (atenção): `#F59E0B`
- **Red** (crítico): `#EF4444`

#### Texto
- `--text-primary`: `#F0F4F3` - Texto principal
- `--text-secondary`: `rgba(255,255,255,0.70)` - Texto secundário
- `--text-muted`: `rgba(255,255,255,0.50)` - Texto terciário

### Tipografia

```css
/* Labels HUD */
font-size: 0.5625rem (9px)
letter-spacing: 0.12em
text-transform: uppercase
color: rgba(227, 241, 255, 0.56)

/* Títulos de painel */
font-size: 0.625rem (10px)
letter-spacing: 0.16em
text-transform: uppercase
color: rgba(224, 238, 252, 0.9)

/* Métricas (KPI) */
font-feature-settings: "tnum" 1
font-variant-numeric: tabular-nums
font-weight: 700
letter-spacing: -0.025em
```

### Espaçamento

- **Padding scale**: 0.5rem (8px), 0.75rem (12px), 1rem (16px), 1.5rem (24px)
- **Gap scale**: 0.25rem (4px), 0.5rem (8px), 0.75rem (12px), 1rem (16px)
- **Border radius**: 0.75rem (12px) para cards, 0.5rem (8px) para inputs

## Component Kit

### Layout

#### `HudPageLayout`
Wrapper de página com background unificado.

```tsx
<HudPageLayout maxWidth="2xl" withBackground>
  {/* content */}
</HudPageLayout>
```

#### `HudHeader`
Cabeçalho de página com breadcrumbs, título, status chips e ações.

```tsx
<HudHeader
  title="Projetos"
  subtitle="Gestão de portfolio"
  icon={<Briefcase className="w-5 h-5" />}
  breadcrumbs={[{ label: 'Projetos' }]}
  statusChips={[{ label: '12 Ativos', variant: 'success' }]}
  actions={<HudButton>Novo</HudButton>}
/>
```

### Dados

#### `HudKpi` / `HudKpiStrip`
Exibição de métricas com variantes de cor e indicadores delta.

```tsx
<HudKpiStrip
  kpis={[
    { id: '1', value: 42, label: 'Projetos', variant: 'info', icon: <Icon /> },
    { id: '2', value: '+12%', label: 'Crescimento', variant: 'success', delta: 12 },
  ]}
  columns={4}
/>
```

#### `HudPanel`
Painel de vidro com header opcional, accent color e deep link.

```tsx
<HudPanel
  title="Visão Geral"
  icon={<Chart className="w-4 h-4" />}
  accentColor="cyan"
  deepLink={{ href: '/detalhes', label: 'Ver tudo' }}
>
  {/* content */}
</HudPanel>
```

#### `HudTable`
Tabela com header sticky, hover states e seleção.

```tsx
<HudTable
  columns={[
    { key: 'name', header: 'Nome', cell: (item) => <span>{item.name}</span> },
  ]}
  data={items}
  keyExtractor={(item) => item.id}
  onRowClick={(item) => console.log(item)}
/>
```

### Filtros

#### `HudFilterBar`
Barra de filtros unificada com busca, selects e chips.

```tsx
<HudFilterBar
  searchPlaceholder="Buscar..."
  searchValue={search}
  onSearchChange={setSearch}
  filterGroups={[
    {
      id: 'status',
      label: 'Status',
      value: status,
      options: [{ value: 'all', label: 'Todos' }],
      onChange: setStatus,
    },
  ]}
  activeFiltersCount={2}
  onClearFilters={handleClear}
/>
```

### Status & Feedback

#### `HudChip`
Chips de status com variantes semânticas.

```tsx
<HudChip label="Crítico" variant="critical" count={3} />
<HudChip label="Ativo" variant="success" />
<HudChip label="Pendente" variant="warning" />
<HudChip label="Live" variant="live" pulseDot />
```

#### `HudStatusPill`
Pills de status arredondados.

```tsx
<HudStatusPill variant="active">Em andamento</HudStatusPill>
<HudStatusPill variant="completed">Concluído</HudStatusPill>
<HudStatusPill variant="critical">Crítico</HudStatusPill>
```

#### `HudBadge`
Badges para tags e categorias.

```tsx
<HudBadge variant="primary">Novo</HudBadge>
<HudBadge variant="outline">Rascunho</HudBadge>
```

#### `HudProgressBar`
Barra de progresso com variantes automáticas.

```tsx
<HudProgressBar value={75} showLabel />
<HudProgressBar value={30} variant="warning" size="sm" />
```

### Formulários

#### `HudInput` / `HudSelect`
Campos de formulário estilizados.

```tsx
<HudInput
  label="Nome"
  value={name}
  onChange={(e) => setName(e.target.value)}
  leftIcon={<User className="w-4 h-4" />}
/>

<HudSelect
  label="Status"
  value={status}
  options={[{ value: 'active', label: 'Ativo' }]}
  onChange={setStatus}
/>
```

### Navegação

#### `HudTabs`
Abas com variantes (default, pills, underline).

```tsx
<HudTabs
  tabs={[
    { id: 'list', label: 'Lista', content: <List /> },
    { id: 'grid', label: 'Grid', content: <Grid /> },
  ]}
  variant="default"
/>
```

### Overlays

#### `HudDrawer`
Painel lateral deslizante.

```tsx
<HudDrawer
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Detalhes"
  position="right"
  width="420px"
>
  {/* content */}
</HudDrawer>
```

#### `HudModal`
Modal centralizado.

```tsx
<HudModal
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Confirmar"
  size="md"
  footer={
    <>
      <HudButton variant="ghost">Cancelar</HudButton>
      <HudButton variant="primary">Confirmar</HudButton>
    </>
  }
>
  {/* content */}
</HudModal>
```

#### `HudToast`
Notificações temporárias.

```tsx
<HudToast
  isOpen={show}
  onClose={() => setShow(false)}
  title="Sucesso"
  description="Operação concluída"
  variant="success"
/>
```

### Ações

#### `HudButton`
Botões com variantes primária, secundária, ghost, danger, glass.

```tsx
<HudButton variant="primary" leftIcon={<Plus />}>Novo</HudButton>
<HudButton variant="secondary">Cancelar</HudButton>
<HudButton variant="ghost" size="sm">Voltar</HudButton>
```

### Estados Vazios

#### `HudEmptyState`
Estado vazio com ícone, título, descrição e ações.

```tsx
<HudEmptyState
  icon="search"
  title="Nenhum resultado"
  description="Tente ajustar os filtros"
  action={{ label: 'Limpar', onClick: handleClear, variant: 'primary' }}
/>
```

## Arquitetura de Páginas

### Padrão de Listagem

```tsx
<HudPageLayout>
  <HudHeader title="Projetos" ... />
  <HudKpiStrip kpis={...} columns={4} />
  <HudFilterBar ... />
  <HudPanel noPadding>
    <HudTable ... />
  </HudPanel>
</HudPageLayout>
```

### Padrão de Detalhe

```tsx
<HudPageLayout>
  <HudHeader title="Detalhes" breadcrumbs={...} ... />
  <div className="grid grid-cols-3 gap-6">
    <div className="col-span-2">
      <HudPanel title="Informações">...</HudPanel>
    </div>
    <div>
      <HudPanel title="Contexto">...</HudPanel>
    </div>
  </div>
</HudPageLayout>
```

## CSS Classes Utilitárias

### Glass Panel (existente em globals.css)

```css
.cr-glass-panel      /* Painel de vidro principal */
.cr-panel-title      /* Título de painel HUD */
.cr-label            /* Label micro uppercase */
.cr-metric           /* Número de métrica */
.cr-metric-lg        /* Métrica grande */
```

### Cores de Background

```css
.bg-[#0a0f0d]        /* Fundo principal */
bg-white/[0.02]     /* Glass subtle */
bg-white/[0.05]     /* Glass medium */
```

### Bordas

```css
border-white/[0.06]   /* Borda sutil */
border-white/[0.08]   /* Borda padrão */
border-cyan-500/30    /* Borda de foco */
```

## Boas Práticas

1. **Sempre use `HudPageLayout`** como wrapper de página
2. **Mantenha consistência nos KPIs** - use `HudKpiStrip` com 4-6 colunas
3. **Reutilize `HudFilterBar`** - centraliza busca e filtros
4. **Use `HudPanel` para cards** - mantém consistência de vidro
5. **Prefira `HudButton`** em vez de botões nativos
6. **Mantenha hierarchy visual** - KPIs > Filtros > Conteúdo
7. **Use `HudEmptyState`** para estados sem dados

## Migração de Componentes Legados

| Legado | Novo |
|--------|------|
| `OrionGreenBackground` | `HudPageLayout` |
| `HUDCard` | `HudPanel` |
| `KpiCard` | `HudKpi` |
| `StatusPill` | `HudStatusPill` |
| `PrimaryCTA` | `HudButton variant="primary"` |
| `SecondaryButton` | `HudButton variant="secondary"` |
| `hud-card` (classe) | `HudPanel` |
| `orion-card-premium` | `HudPanel` |

## Arquivos Modificados

### Novos Componentes (17 arquivos)
- `src/components/hud/index.ts` - Barrel export
- `src/components/hud/HudPanel.tsx`
- `src/components/hud/HudHeader.tsx`
- `src/components/hud/HudChip.tsx`
- `src/components/hud/HudKpi.tsx`
- `src/components/hud/HudKpiStrip.tsx`
- `src/components/hud/HudFilterBar.tsx`
- `src/components/hud/HudTable.tsx`
- `src/components/hud/HudButton.tsx`
- `src/components/hud/HudBadge.tsx`
- `src/components/hud/HudStatusPill.tsx`
- `src/components/hud/HudInput.tsx`
- `src/components/hud/HudSelect.tsx`
- `src/components/hud/HudTabs.tsx`
- `src/components/hud/HudDrawer.tsx`
- `src/components/hud/HudModal.tsx`
- `src/components/hud/HudEmptyState.tsx`
- `src/components/hud/HudToast.tsx`
- `src/components/hud/HudPageLayout.tsx`
- `src/components/hud/HudProgressBar.tsx`

### Páginas Refatoradas
- `src/app/(main)/projetos/page.tsx`
- `src/app/(main)/contratos/page.tsx`
- `src/app/(main)/riscos/page.tsx`

## Referências

- CSS Glassmorphism: `src/app/globals.css` (classes `.cr-glass-panel`, `.hud-bar`, `.hud-sidebar`)
- Tailwind Config: `tailwind.config.ts` (cores `sentinel.*`, `intel.*`)
- Dashboard de Referência: `src/app/(main)/dashboard/page.tsx`
