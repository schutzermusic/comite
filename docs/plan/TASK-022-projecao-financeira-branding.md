# TASK-022 — Projeção Financeira: adotar a marca da empresa nos exports

**Status:** aberto (follow-up)
**Origem:** PR do cockpit de Pessoas & Custos (15/08/2026)
**Escopo desta task:** apenas Financeiro › Projeção Financeira. Pessoas & Custos já foi migrado.

## Resumo

> Refatorar os exports de PDF/HTML/PPTX da Projeção Financeira para usar
> `src/lib/reports/report-branding.ts` e remover a dependência do
> `apex-logo.ts` hardcoded.

## Contexto

Durante o redesign de Pessoas & Custos foi descoberto que a Projeção Financeira
**não usa a marca da empresa**. Os três exports importam um wordmark Insight
Energy fixo, em base64:

| Arquivo | Uso do logo hardcoded |
| --- | --- |
| `src/lib/finance/investor-pack/apex-pdf.ts` | capa, fecho institucional, rodapé (`APEX_LOGO_DATA_URI`, `APEX_LOGO_SMALL_DATA_URI`) |
| `src/lib/finance/investor-pack/html-presentation.ts` | hero, fecho, rodapé |
| `src/lib/finance/investor-pack/pptx-server.ts` | capa e rodapé por slide (`addLogo`) |

O módulo `src/lib/branding.ts` — que sabe ler `organizations.logo_url`,
respeitar `branding_enabled` e cair na marca do produto — existia com
**zero consumidores** até este PR.

Consequência hoje: um cliente que subiu a própria marca em
Configurações › Branding recebe material de investidor com a marca da
plataforma.

## O que já existe (feito em Pessoas & Custos)

`src/lib/reports/report-branding.ts` foi criado **genérico de propósito** — fora
de `workforce/` — justamente para esta adoção:

- `ReportBranding` — `{ companyName, logoDataUri, logoSmallDataUri, logoAspect, logoAlt, isCustomLogo, brandColor }`
- `buildReportBranding(org, resolvedLogo)` — puro; cai em `FALLBACK_REPORT_BRANDING` sem logo, sem organização, com `branding_enabled: false` ou com download falho
- `fitLogoBox(branding, bounds)` — maior caixa sem distorcer (o PPTX posiciona por coordenada)
- `logoBackgroundCss(dataUri, opts)` — `contain` + `no-repeat` para PDF e HTML
- `useReportBranding()` (`src/hooks/use-report-branding.ts`) — busca, converte para data URI e mede a proporção real

## Passos

1. Adicionar `branding: ReportBranding` ao `InvestorPack` (ou ao snapshot passado aos builders), alimentado por `useReportBranding()` na página.
2. `apex-pdf.ts` — trocar `APEX_LOGO_*` por `branding.logoDataUri` / `logoSmallDataUri`; usar `logoBackgroundCss()` no lugar das regras `background: url(...) / contain` fixas.
3. `html-presentation.ts` — idem no hero, no fecho e no rodapé.
4. `pptx-server.ts` — `addLogo()` passa a receber a marca; substituir `APEX_LOGO_ASPECT` por `fitLogoBox()`.
5. `apex-theme.ts` — remover `APEX_BRAND` como fonte de nome, lendo de `branding.companyName`.
6. Manter `apex-logo.ts` **apenas** como reserva do produto (já é o que `FALLBACK_REPORT_BRANDING` usa), ou apagá-lo se `report-branding` passar a ser a única porta.
7. A rota `/api/finance/investor-pack/pptx` precisa receber a marca junto do pack (mesmo padrão da rota de Pessoas & Custos, que recebe o modelo já montado).

## Aceite

- [ ] PDF, apresentação HTML e PPTX da Projeção Financeira usam o logo de Configurações › Branding
- [ ] Reserva do produto funciona sem imagem quebrada quando não há `logo_url`
- [ ] Logo quadrado e logo largo mantêm proporção nos três destinos
- [ ] Nenhuma URL remota nos documentos (o deck HTML precisa continuar autocontido)
- [ ] `scripts/qa-investor-pack-exports.ts` estendido com uma fixture de marca de cliente
- [ ] typecheck, testes e build passando

## Referência

Implementação equivalente já entregue: `src/lib/workforce/overview/report/{pdf,presentation,pptx-server}.ts`
e os testes em `tests/unit/report-branding.test.ts` e `tests/unit/workforce-overview-exports.test.ts`
(bloco "marca da empresa atravessa os destinos").
