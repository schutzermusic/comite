/**
 * Evidência de recebimento — regras compartilhadas por servidor e navegador.
 *
 * Os formatos são os que o bucket canônico (`contract-files`) aceita. Foto de
 * celular em HEIC/WEBP é convertida para JPEG NO APARELHO antes do envio: o
 * bucket recusaria o original, e a evidência tem de abrir em qualquer tela.
 */
export const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type EvidenceMime = (typeof EVIDENCE_MIME)[number];
export const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;

/**
 * O tipo que o CONTEÚDO declara (assinatura dos primeiros bytes), não o que o
 * navegador disse. Um arquivo cujo conteúdo não bate com o tipo não é evidência.
 */
export function sniffEvidenceMime(bytes: Uint8Array): EvidenceMime | null {
  const at = (i: number) => bytes[i];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => at(i) === b)) return 'image/png';
  if (bytes.length >= 5 && [0x25, 0x50, 0x44, 0x46, 0x2d].every((b, i) => at(i) === b)) return 'application/pdf';
  return null;
}

/**
 * O que fazer com o arquivo escolhido ANTES do envio (regra pura, testável):
 *  - `send`: JPEG/PNG/PDF dentro do teto — vai como está;
 *  - `reencode`: outra imagem (HEIC, WEBP…) ou foto grande demais — vira JPEG
 *    no aparelho (o bucket recusaria o original);
 *  - `reject`: não é imagem nem PDF, ou é PDF acima do teto.
 */
export function evidencePlan(type: string, name: string, size: number): 'send' | 'reencode' | 'reject' {
  const known = (EVIDENCE_MIME as readonly string[]).includes(type);
  const image = type.startsWith('image/') || /\.(heic|heif|webp|avif)$/i.test(name);
  if (known && size > 0 && size <= MAX_EVIDENCE_BYTES) return 'send';
  if (image && size > 0) return 'reencode';
  return 'reject';
}
