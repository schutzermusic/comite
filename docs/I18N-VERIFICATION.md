# Verificação de i18n (pt-BR)

## Resumo

A aplicação usa **next-intl** com locale padrão **pt-BR**. As traduções estão em `src/locales/pt-BR/` por namespace.

## Arquivos de tradução

| Arquivo | Uso |
|---------|-----|
| `src/locales/pt-BR/common.json` | UI global: botões, sidebar, labels comuns |
| `src/locales/pt-BR/dashboard.json` | Dashboard: HUD, painéis, filtros de período/modo |
| `src/locales/pt-BR/projects.json` | Página Projetos: filtros, tabela, KPIs, mensagens |
| `src/locales/pt-BR/contracts.json` | Página Contratos: KPIs, abas, filtros |
| `src/locales/pt-BR/risks.json` | Página Riscos: formulário, filtros, matriz |
| `src/locales/pt-BR/meetings.json` | Página Reuniões |
| `src/locales/pt-BR/deliberations.json` | Página Deliberações / Pautas |

## Formatação pt-BR

- **Moeda**: `src/lib/i18n/format.ts` — `formatCurrency(value)` em BRL (R$), separador de milhares e decimais pt-BR.
- **Datas**: `formatDate()`, `formatDateTime()` em dd/MM/yyyy (e hora quando aplicável).
- **Fuso**: `America/Sao_Paulo` definido em `src/i18n/request.ts`.

Para usar nos componentes:

```ts
import { formatCurrency, formatDate } from '@/lib/i18n/format';
formatCurrency(1000);   // "R$ 1.000,00"
formatDate(new Date()); // "28/02/2025"
```

## Como testar que a UI está em português

1. **Build e execução**
   ```bash
   npm run build && npm run start
   ```
2. **Navegação**
   - Sidebar: todos os itens em português (Dashboard, Projetos, Reuniões, Deliberações, Riscos, Contratos, etc.).
   - Dashboard: título "Sala de Controle Executivo", filtros MTD/QTD/YTD, chips Críticos/Votos 72h/Docs pendentes, painéis (Visão do Portfólio, Resumo Financeiro, Fila Executiva, SLA de Decisão / Votos, Exposição a Riscos, Fluxo de Eventos).
   - Projetos: título "Projetos", "Gestão de Projetos Ativos", filtros e tabela em pt-BR.
   - Contratos: título "Gestão de Contratos", KPIs (Exposição, Backlog, Faturado, Renovações 90d, Alto Risco, Docs Faltantes), abas Contratos/Empresas/Projetos.
   - Riscos: título "Riscos", KPIs e filtros em pt-BR.
3. **Script de varredura**
   ```bash
   npm run i18n:scan
   ```
   Se houver strings em inglês suspeitas, o script lista arquivo, linha e trecho. Objetivo: saída vazia ou apenas itens já tratados/ falsos positivos.

## Checklist rápido

- [ ] Sidebar e footer (Configurações, Sair) em pt-BR
- [ ] Dashboard (barra, painéis esquerdo/direito) em pt-BR
- [ ] Projetos (cabeçalho, KPIs, filtros, tabela, botões, diálogo de exclusão) em pt-BR
- [ ] Contratos (cabeçalho, KPIs, abas, filtros) em pt-BR
- [ ] Riscos (cabeçalho, KPIs, filtros, modal Novo Risco) em pt-BR
- [ ] Reuniões e Deliberações: textos visíveis em pt-BR
- [ ] Configurações (Preferências de Notificação): em pt-BR
- [ ] Mensagens de validação e toasts em pt-BR
- [ ] `npm run i18n:scan` sem restos de inglês relevantes

## Troca de idioma (futuro)

O locale padrão é pt-BR e não há segmento `[locale]` na URL. Para adicionar seletor de idioma (ex.: em Configurações):

1. Incluir outro locale em `src/i18n/request.ts` (ex.: `en`) e carregar mensagens `en/*.json`.
2. Persistir preferência (cookie ou storage) e ler em `getRequestConfig` para definir `locale` e `messages`.
3. Opcional: usar roteamento por locale com `[locale]` no App Router (ver documentação next-intl).

## Arquivos alterados (principais)

- `next.config.ts` — plugin next-intl
- `src/app/layout.tsx` — NextIntlClientProvider, `getLocale`/`getMessages`, `lang="pt-BR"`
- `src/i18n/request.ts` — configuração pt-BR e merge de namespaces
- `src/locales/pt-BR/*.json` — 7 arquivos de tradução
- `src/lib/i18n/format.ts` — formatadores pt-BR
- `src/components/layout/app-sidebar.tsx` — uso de `useTranslations('common')`
- `src/components/dashboard/DashboardHudBar.tsx` — uso de `useTranslations('dashboard')`
- `src/components/dashboard/LeftHudStack.tsx` — traduções dashboard
- `src/components/dashboard/RightHudStack.tsx` — traduções dashboard
- `src/app/(main)/projetos/page.tsx` — uso de `useTranslations('projects')` e `common`
- `src/app/(main)/contratos/page.tsx` — uso de `useTranslations('contracts')` e `common`
- `scripts/scan-english-strings.mjs` — varredura de strings em inglês
- `package.json` — script `i18n:scan`

Outras páginas (riscos, reuniões, pautas, configurações, etc.) podem ser migradas progressivamente para `useTranslations` usando os mesmos namespaces e arquivos em `src/locales/pt-BR/`.
