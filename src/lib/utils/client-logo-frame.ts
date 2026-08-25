/**
 * Frame canônico da logo do cliente nos projetos.
 *
 * A CEMIG preenche o card porque o arquivo é 1280×337, recortado rente.
 * Toda logo — no upload e na tela — entra nesse mesmo retângulo, sem
 * distorcer: o conteúdo é recortado (sem fundo vazio) e encaixado com
 * contain, centrado, com o mesmo respiro de ~8 px da CEMIG.
 */

export const CLIENT_LOGO_FRAME_WIDTH = 1280;
export const CLIENT_LOGO_FRAME_HEIGHT = 337;
export const CLIENT_LOGO_ASPECT = CLIENT_LOGO_FRAME_WIDTH / CLIENT_LOGO_FRAME_HEIGHT;
/** Respiro interno, em px no canvas 1280×337 — o da logo CEMIG de referência. */
export const CLIENT_LOGO_INSET = 8;

const ALPHA_CONTENT = 8;
const WHITE_MIN = 250;

export function clientLogoSlotSize(heightPx: number): { width: number; height: number } {
  const height = Math.max(1, Math.round(heightPx));
  return {
    height,
    width: Math.max(1, Math.round((height * CLIENT_LOGO_FRAME_WIDTH) / CLIENT_LOGO_FRAME_HEIGHT)),
  };
}

export function fitContentInFrame(
  contentW: number,
  contentH: number,
  frameW = CLIENT_LOGO_FRAME_WIDTH,
  frameH = CLIENT_LOGO_FRAME_HEIGHT,
  inset = CLIENT_LOGO_INSET,
): { x: number; y: number; width: number; height: number } {
  const srcW = Math.max(1, contentW);
  const srcH = Math.max(1, contentH);
  const innerW = Math.max(1, frameW - inset * 2);
  const innerH = Math.max(1, frameH - inset * 2);
  const scale = Math.min(innerW / srcW, innerH / srcH);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  return {
    x: inset + Math.round((innerW - width) / 2),
    y: inset + Math.round((innerH - height) / 2),
    width,
    height,
  };
}

export type ContentBBox = { x: number; y: number; width: number; height: number };

/**
 * Recorte do desenho útil em RGBA (4 bytes/pixel).
 * Com transparência: corta pelo alpha. JPEG opaco: corta fundo branco.
 */
export function findContentBBox(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): ContentBBox | null {
  if (width <= 0 || height <= 0) return null;

  let hasTransparency = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] <= ALPHA_CONTENT) {
      hasTransparency = true;
      break;
    }
  }

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const isContent = hasTransparency
        ? a > ALPHA_CONTENT
        : a > ALPHA_CONTENT && (r < WHITE_MIN || g < WHITE_MIN || b < WHITE_MIN);
      if (!isContent) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function clampBBox(bbox: ContentBBox, width: number, height: number): ContentBBox {
  const x = Math.max(0, Math.min(width - 1, bbox.x));
  const y = Math.max(0, Math.min(height - 1, bbox.y));
  const w = Math.max(1, Math.min(width - x, bbox.width));
  const h = Math.max(1, Math.min(height - y, bbox.height));
  return { x, y, width: w, height: h };
}
