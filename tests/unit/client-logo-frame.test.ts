import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  CLIENT_LOGO_FRAME_HEIGHT,
  CLIENT_LOGO_FRAME_WIDTH,
  CLIENT_LOGO_INSET,
  clientLogoSlotSize,
  findContentBBox,
  fitContentInFrame,
} from '@/lib/utils/client-logo-frame';
import { normalizeClientLogoBuffer } from '@/lib/utils/normalize-client-logo.node';

function rgba(width: number, height: number, fill: [number, number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return data;
}

function paintRect(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number, number],
) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * width + xx) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
}

describe('frame 1280×337', () => {
  it('a caixa do card (32px) tem a proporção da CEMIG', () => {
    const slot = clientLogoSlotSize(32);
    expect(slot.height).toBe(32);
    expect(slot.width).toBe(122);
  });

  it('o header (40px) também segue 1280/337', () => {
    const slot = clientLogoSlotSize(40);
    expect(slot).toEqual({ width: 152, height: 40 });
  });
});

describe('recorte do desenho', () => {
  it('ignora padding transparente e devolve só a tinta', () => {
    const data = rgba(20, 10, [0, 0, 0, 0]);
    paintRect(data, 20, 4, 2, 10, 5, [0, 128, 0, 255]);
    expect(findContentBBox(data, 20, 10)).toEqual({ x: 4, y: 2, width: 10, height: 5 });
  });

  it('em JPEG opaco, corta fundo branco', () => {
    const data = rgba(12, 8, [255, 255, 255, 255]);
    paintRect(data, 12, 2, 1, 6, 4, [10, 80, 40, 255]);
    expect(findContentBBox(data, 12, 8)).toEqual({ x: 2, y: 1, width: 6, height: 4 });
  });

  it('imagem vazia devolve null', () => {
    expect(findContentBBox(rgba(4, 4, [0, 0, 0, 0]), 4, 4)).toBeNull();
  });
});

describe('encaixe contain no frame', () => {
  it('wordmark largo da CEMIG (1262×318) preenche a LARGURA interna', () => {
    const fit = fitContentInFrame(1262, 318);
    expect(fit.width + CLIENT_LOGO_INSET * 2).toBeLessThanOrEqual(CLIENT_LOGO_FRAME_WIDTH);
    expect(fit.height + CLIENT_LOGO_INSET * 2).toBeLessThanOrEqual(CLIENT_LOGO_FRAME_HEIGHT);
    expect(fit.x).toBe(CLIENT_LOGO_INSET);
    expect(fit.width).toBe(CLIENT_LOGO_FRAME_WIDTH - CLIENT_LOGO_INSET * 2);
  });

  it('logo mais quadrada (ENEL 802×432) preenche a ALTURA — o mesmo peso visual da CEMIG', () => {
    const fit = fitContentInFrame(802, 432);
    expect(fit.y).toBe(CLIENT_LOGO_INSET);
    expect(fit.height).toBe(CLIENT_LOGO_FRAME_HEIGHT - CLIENT_LOGO_INSET * 2);
    expect(fit.width).toBeLessThan(CLIENT_LOGO_FRAME_WIDTH - CLIENT_LOGO_INSET * 2);
    expect(fit.width / fit.height).toBeCloseTo(802 / 432, 2);
  });
});

describe('normalização sharp → 1280×337', () => {
  it('um bloco com padding sai no canvas canônico, recortado e sem distorção', async () => {
    const mark = await sharp({
      create: { width: 400, height: 80, channels: 4, background: { r: 0, g: 128, b: 60, alpha: 255 } },
    })
      .png()
      .toBuffer();

    const padded = await sharp({
      create: { width: 700, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: mark, left: 80, top: 140 }])
      .png()
      .toBuffer();

    const out = await normalizeClientLogoBuffer(padded);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(CLIENT_LOGO_FRAME_WIDTH);
    expect(meta.height).toBe(CLIENT_LOGO_FRAME_HEIGHT);
    expect(meta.format).toBe('png');

    const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bbox = findContentBBox(data, info.width, info.height);
    expect(bbox).not.toBeNull();
    // 400×80 é mais largo que 1280×337: preenche a largura interna.
    expect(bbox!.width).toBeGreaterThan(1200);
    expect(bbox!.x).toBeLessThanOrEqual(CLIENT_LOGO_INSET + 1);
    expect(bbox!.width / bbox!.height).toBeCloseTo(400 / 80, 1);
  });

  it('logo já 1280×337 continua 1280×337', async () => {
    const original = await sharp({
      create: {
        width: CLIENT_LOGO_FRAME_WIDTH,
        height: CLIENT_LOGO_FRAME_HEIGHT,
        channels: 4,
        background: { r: 0, g: 90, b: 50, alpha: 255 },
      },
    })
      .png()
      .toBuffer();
    const out = await normalizeClientLogoBuffer(original);
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(337);
  });
});
