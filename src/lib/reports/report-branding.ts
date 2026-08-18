/**
 * Marca da empresa nos documentos exportados.
 *
 * Fonte única de branding para PDF, apresentação HTML e PowerPoint — de
 * qualquer módulo, não só de Pessoas & Custos. O logo vem do que o
 * administrador subiu em Configurações › Branding
 * (`organizations.logo_url`, gravado por `/api/admin/organization/branding/logo`),
 * com a marca do produto como reserva.
 *
 * ─── Por que o logo é SEMPRE um data URI ───────────────────────────────────
 *
 * O `logo_url` guardado é uma URL pública do Storage. Referenciá-la direto
 * quebraria os três destinos, cada um por um motivo diferente:
 *
 *   • a apresentação HTML é um arquivo único, aberto offline numa sala de
 *     reunião e enviado por e-mail — há teste proibindo qualquer URL externa;
 *   • o PDF abre em `about:blank` via `window.open`, onde caminho relativo não
 *     resolve e uma imagem remota pode não chegar antes da impressão;
 *   • o PPTX precisa dos BYTES da imagem para embutir no pacote OOXML.
 *
 * Por isso a resolução (buscar, converter, medir) acontece uma vez no cliente,
 * em `use-report-branding.ts`, e o resultado viaja no modelo.
 *
 * ─── Este arquivo é puro ──────────────────────────────────────────────────
 *
 * Sem React e sem DOM: ele roda no navegador, na rota do PowerPoint e nos
 * harnesses em Node.
 */

import {
  PRODUCT_NAME,
  getBrandColor,
  getWorkspaceName,
  hasCustomLogo,
  type BrandingOrganization,
} from '@/lib/branding';
import {
  APEX_LOGO_ALT,
  APEX_LOGO_ASPECT,
  APEX_LOGO_DATA_URI,
  APEX_LOGO_SMALL_DATA_URI,
} from '@/lib/finance/investor-pack/apex-logo';

export interface ReportBranding {
  /** Nome exibido na capa e no rodapé. */
  companyName: string;
  /** Marca completa, sempre como data URI — nunca URL remota. */
  logoDataUri: string;
  /** Variante reduzida para rodapé. Igual à completa quando não há outra. */
  logoSmallDataUri: string;
  /**
   * Proporção largura/altura da imagem REAL.
   *
   * É o que impede o logo de esticar: cada destino fixa uma das dimensões e
   * calcula a outra a partir daqui, em vez de assumir um formato.
   */
  logoAspect: number;
  logoAlt: string;
  /** Falso quando caiu na marca do produto. */
  isCustomLogo: boolean;
  brandColor: string;
}

/**
 * Marca do produto — usada quando a organização não subiu logo, quando o
 * branding personalizado está desligado, ou quando o download falhou.
 *
 * É a mesma imagem que a Projeção Financeira embute hoje, então os materiais
 * dos dois módulos continuam idênticos quando não há marca do cliente.
 */
export const FALLBACK_REPORT_BRANDING: ReportBranding = {
  companyName: 'Insight Energy',
  logoDataUri: APEX_LOGO_DATA_URI,
  logoSmallDataUri: APEX_LOGO_SMALL_DATA_URI,
  logoAspect: APEX_LOGO_ASPECT,
  logoAlt: APEX_LOGO_ALT,
  isCustomLogo: false,
  brandColor: '#008751',
};

/** Proporção usada quando a imagem não declara dimensões (SVG sem width/height). */
export const DEFAULT_LOGO_ASPECT = 4;

/**
 * Monta o branding a partir da organização e de um logo JÁ resolvido.
 *
 * Puro de propósito: quem busca os bytes é o chamador, porque só ele sabe se
 * está no navegador, no servidor ou num harness.
 */
export function buildReportBranding(
  org: BrandingOrganization | null | undefined,
  resolvedLogo?: { dataUri: string; aspect: number } | null,
): ReportBranding {
  // Sem logo próprio resolvido, o material sai com a marca do produto — e
  // `companyName` acompanha, para não misturar nome de cliente com logo alheio.
  if (!resolvedLogo || !hasCustomLogo(org)) return FALLBACK_REPORT_BRANDING;

  const companyName = org?.name?.trim() || getWorkspaceName(org) || PRODUCT_NAME;

  return {
    companyName,
    logoDataUri: resolvedLogo.dataUri,
    // A mesma imagem serve o rodapé: reduzi-la exigiria rasterizar, e o ganho
    // de bytes não compensa o risco de perder nitidez numa marca do cliente.
    logoSmallDataUri: resolvedLogo.dataUri,
    logoAspect:
      Number.isFinite(resolvedLogo.aspect) && resolvedLogo.aspect > 0
        ? resolvedLogo.aspect
        : DEFAULT_LOGO_ASPECT,
    logoAlt: companyName,
    isCustomLogo: true,
    brandColor: getBrandColor(org),
  };
}

/**
 * Caixa do logo respeitando a proporção.
 *
 * Recebe o espaço disponível e devolve a caixa MÁXIMA que cabe nele sem
 * distorcer — é o `object-fit: contain` calculado, para os destinos que
 * precisam de números (PowerPoint posiciona imagem por coordenada, não por
 * CSS).
 */
export function fitLogoBox(
  branding: ReportBranding,
  bounds: { maxWidth: number; maxHeight: number },
): { width: number; height: number } {
  const aspect = branding.logoAspect > 0 ? branding.logoAspect : DEFAULT_LOGO_ASPECT;
  const widthFromHeight = bounds.maxHeight * aspect;

  if (widthFromHeight <= bounds.maxWidth) {
    return { width: widthFromHeight, height: bounds.maxHeight };
  }
  return { width: bounds.maxWidth, height: bounds.maxWidth / aspect };
}

/**
 * CSS de um logo para PDF e deck HTML.
 *
 * `contain` + `no-repeat` garantem que a marca nunca estica nem corta, seja
 * ela quadrada, larga ou vertical. A área de respiro fica na margem do
 * elemento, não no recorte da imagem.
 */
export function logoBackgroundCss(
  dataUri: string,
  opts: { height: string; maxWidth: string; align?: 'left' | 'center' },
): string {
  const position = opts.align === 'center' ? 'center center' : 'left center';
  return (
    `display:block;height:${opts.height};width:${opts.maxWidth};` +
    `background:url('${dataUri}') ${position} / contain no-repeat;`
  );
}
