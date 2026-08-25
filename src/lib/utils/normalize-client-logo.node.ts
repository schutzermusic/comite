/**
 * Normaliza a logo do cliente para o frame 1280×337 (Node / sharp).
 * Mesma geometria do normalizador do browser — usado em testes e backfill.
 */

import sharp from 'sharp';
import {
  CLIENT_LOGO_FRAME_HEIGHT,
  CLIENT_LOGO_FRAME_WIDTH,
  clampBBox,
  findContentBBox,
  fitContentInFrame,
} from './client-logo-frame';

export async function normalizeClientLogoBuffer(input: Buffer): Promise<Buffer> {
  const pipeline = sharp(input, { density: 384 }).ensureAlpha();
  const { data, info } = await pipeline.clone().raw().toBuffer({ resolveWithObject: true });
  const detected = findContentBBox(data, info.width, info.height);
  const bbox = clampBBox(
    detected ?? { x: 0, y: 0, width: info.width, height: info.height },
    info.width,
    info.height,
  );
  const fit = fitContentInFrame(bbox.width, bbox.height);
  const bottom = CLIENT_LOGO_FRAME_HEIGHT - fit.y - fit.height;
  const right = CLIENT_LOGO_FRAME_WIDTH - fit.x - fit.width;

  return sharp(input, { density: 384 })
    .ensureAlpha()
    .extract({ left: bbox.x, top: bbox.y, width: bbox.width, height: bbox.height })
    .resize(fit.width, fit.height, { fit: 'fill', kernel: 'lanczos3' })
    .extend({
      top: fit.y,
      bottom,
      left: fit.x,
      right,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}
