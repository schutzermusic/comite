import { getRequestConfig } from 'next-intl/server';

export const defaultLocale = 'pt-BR' as const;

export default getRequestConfig(async () => {
  const locale = defaultLocale;

  const [common, dashboard, projects, contracts, risks, meetings, deliberations, finance] = await Promise.all([
    import(`@/locales/pt-BR/common.json`).then((m) => m.default),
    import(`@/locales/pt-BR/dashboard.json`).then((m) => m.default),
    import(`@/locales/pt-BR/projects.json`).then((m) => m.default),
    import(`@/locales/pt-BR/contracts.json`).then((m) => m.default),
    import(`@/locales/pt-BR/risks.json`).then((m) => m.default),
    import(`@/locales/pt-BR/meetings.json`).then((m) => m.default),
    import(`@/locales/pt-BR/deliberations.json`).then((m) => m.default),
    import(`@/locales/pt-BR/finance.json`).then((m) => m.default),
  ]);

  return {
    locale,
    messages: {
      common,
      dashboard,
      projects,
      contracts,
      risks,
      meetings,
      deliberations,
      finance,
    },
    timeZone: 'America/Sao_Paulo',
  };
});
