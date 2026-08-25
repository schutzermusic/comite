/**
 * Normaliza a logo do cliente para o frame 1280×337 (browser).
 * Recorta fundo vazio e encaixa o desenho com contain, sem distorcer.
 */

import {
  CLIENT_LOGO_FRAME_HEIGHT,
  CLIENT_LOGO_FRAME_WIDTH,
  clampBBox,
  findContentBBox,
  fitContentInFrame,
} from './client-logo-frame';

const MAX_DECODE_SIDE = 4096;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível ler a imagem da logo.'));
    img.src = src;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Falha ao gerar a logo padronizada.'));
    }, 'image/png');
  });
}

function drawSource(img: HTMLImageElement): HTMLCanvasElement {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (!w || !h) {
    w = CLIENT_LOGO_FRAME_WIDTH;
    h = CLIENT_LOGO_FRAME_HEIGHT;
  }
  const scale = Math.min(1, MAX_DECODE_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível para padronizar a logo.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  return canvas;
}

export async function normalizeClientLogoFile(file: File | Blob): Promise<File> {
  if (typeof document === 'undefined') {
    throw new Error('A padronização da logo roda no navegador.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const source = drawSource(img);
    const ctx = source.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponível para padronizar a logo.');

    const imageData = ctx.getImageData(0, 0, source.width, source.height);
    const detected = findContentBBox(imageData.data, source.width, source.height);
    const bbox = clampBBox(
      detected ?? { x: 0, y: 0, width: source.width, height: source.height },
      source.width,
      source.height,
    );
    const fit = fitContentInFrame(bbox.width, bbox.height);

    const out = document.createElement('canvas');
    out.width = CLIENT_LOGO_FRAME_WIDTH;
    out.height = CLIENT_LOGO_FRAME_HEIGHT;
    const outCtx = out.getContext('2d');
    if (!outCtx) throw new Error('Canvas indisponível para padronizar a logo.');
    outCtx.clearRect(0, 0, out.width, out.height);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(
      source,
      bbox.x,
      bbox.y,
      bbox.width,
      bbox.height,
      fit.x,
      fit.y,
      fit.width,
      fit.height,
    );

    const blob = await canvasToPngBlob(out);
    return new File([blob], 'client-logo.png', { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
