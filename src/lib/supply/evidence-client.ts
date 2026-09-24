'use client';

/**
 * Evidência no APARELHO: foto de celular em HEIC/WEBP (ou grande demais) vira
 * JPEG antes do envio. O servidor confere de novo pelo conteúdo (assinatura
 * dos bytes) — isto só evita mandar o que seria recusado.
 */
import { MAX_EVIDENCE_BYTES, evidencePlan } from './evidence';

const MAX_SIDE = 2400;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
    } catch { /* o navegador não decodifica este formato por aqui: tenta pela <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error('decode')); el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Este formato de foto não abre neste aparelho. Tire a foto em JPEG ou envie um PDF.');
  }
}

export async function prepareEvidence(file: File): Promise<File> {
  const plan = evidencePlan(file.type, file.name, file.size);
  if (plan === 'send') return file;
  if (plan === 'reject') {
    throw new Error(file.type === 'application/pdf' ? 'PDF acima de 15 MB.' : 'Envie uma foto (JPEG/PNG) ou um PDF.');
  }
  const img = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível preparar a foto neste aparelho.');
    ctx.drawImage(img.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob || blob.size > MAX_EVIDENCE_BYTES) throw new Error('A foto ficou grande demais mesmo reduzida.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'evidencia'}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    img.done();
  }
}
