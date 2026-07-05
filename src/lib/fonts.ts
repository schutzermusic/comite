/**
 * Stacks de fonte literais para contextos onde `var(--font-gilroy)` não resolve:
 * canvas (ctx.font), opções de ECharts, atributos SVG e HTML de relatório
 * renderizado em janela própria (window.open + document.write).
 *
 * Para CSS normal, use `var(--font-gilroy)` (globals.css) ou as utilities
 * Tailwind `font-sans` / `font-body` / `font-display`.
 */
export const FONT_FAMILY_SANS =
  "'Gilroy', 'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** Apenas para IDs, hashes, código e saída técnica — nunca para KPIs/valores financeiros. */
export const FONT_FAMILY_MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const GILROY_WEIGHT_FILES: Array<[number, string]> = [
  [400, 'Gilroy-Regular.ttf'],
  [600, 'Gilroy-SemiBold.ttf'],
  [700, 'Gilroy-Bold.ttf'],
  [800, 'Gilroy-ExtraBold.ttf'],
];

/**
 * @font-face da Gilroy para documentos de relatório abertos em janela `about:blank`
 * (base URI não resolve URLs relativas — exige origin absoluto).
 * Não usar data URIs: inflaria cada HTML de relatório em ~1-2MB por peso.
 */
export function buildGilroyFontFaceCss(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (!origin) return '';
  return GILROY_WEIGHT_FILES.map(
    ([weight, file]) => `@font-face {
  font-family: 'Gilroy';
  src: url('${origin}/fonts/gilroy/${file}') format('truetype');
  font-weight: ${weight};
  font-style: normal;
  font-display: swap;
}`
  ).join('\n');
}
