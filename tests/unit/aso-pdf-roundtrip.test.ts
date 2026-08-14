import { describe, expect, it } from 'vitest';
import { extractAso, isWeakExtraction, reconcileWithEsocial } from '@/lib/workforce/aso-extractor';

/**
 * Ida e volta pelo pdfjs.
 *
 * Os outros testes do ASO partem de texto já extraído, o que deixa um vão: a
 * ponte entre o PDF e o extrator nunca era exercitada, e é justamente onde uma
 * troca de versão do pdfjs quebra em silêncio — `getTextContent` passa a
 * devolver os itens de outro jeito e a extração inteira vira "documento
 * ilegível" sem que nenhum teste reclame.
 *
 * O PDF é montado à mão (xref calculado) para não depender de fixture binário
 * nem de biblioteca de geração.
 */

/** PDF mínimo válido com uma página de texto. */
function makePdf(lines: string[]): Buffer {
  const content =
    'BT /F1 11 Tf 40 750 Td 14 TL\n' +
    lines.map((l) => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n') +
    '\nET';
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** Exatamente a extração da rota de upload. */
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    useSystemFonts: true,
  });
  const doc = await task.promise;
  const parts: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      parts.push(
        content.items
          .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
          .join(' '),
      );
    }
  } finally {
    await task.destroy();
  }
  return parts.join('\n');
}

const HOJE = new Date('2026-08-13T00:00:00Z');

const PERIODICO_COM_VALIDADE = [
  'ATESTADO DE SAUDE OCUPACIONAL - ASO',
  'Empresa: INSIGHT ENERGY LTDA',
  'Nome: JOSE DA SILVA',
  'CPF: 123.456.789-01',
  'Tipo de Exame: Periodico',
  'Data do Exame Clinico: 10/03/2026',
  'Resultado: APTO para a funcao',
  'Valido ate: 10/03/2027',
  'Dr. Maria Fernanda Souza  CRM: 123456',
];

describe('ASO: PDF → pdfjs → extrator', () => {
  it('lê um ASO com validade escrita e a marca como DECLARADA', async () => {
    const text = await extractPdfText(makePdf(PERIODICO_COM_VALIDADE));
    expect(text.length).toBeGreaterThan(0);

    const r = extractAso(text, HOJE);
    expect(r.examDate).toBe('2026-03-10');
    expect(r.examKind).toBe('1');
    expect(r.result).toBe('1');
    expect(r.validityDate).toBe('2027-03-10');
    // Estava escrito no papel: fato do documento, não premissa nossa.
    expect(r.validityBasis).toBe('declared_document');
    expect(r.cpf).toBe('12345678901');
    expect(isWeakExtraction(r)).toBe(false);
  }, 30_000);

  it('infere validade do periódico sem data escrita, e diz que inferiu', async () => {
    const text = await extractPdfText(
      makePdf([
        'ATESTADO DE SAUDE OCUPACIONAL',
        'Nome: CARLOS PEREIRA',
        'CPF: 111.222.333-44',
        'Exame Periodico',
        'Data do exame: 05/02/2026',
        'Considerado APTO',
      ]),
    );
    const r = extractAso(text, HOJE);
    expect(r.validityDate).toBe('2027-02-05');
    expect(r.validityBasis).toBe('inferred_periodicity');
  }, 30_000);

  it('deixa o admissional sem vencimento apurável', async () => {
    const text = await extractPdfText(
      makePdf([
        'ATESTADO DE SAUDE OCUPACIONAL',
        'Nome: MARIA APARECIDA',
        'Exame Admissional',
        'Data do exame: 05/01/2026',
        'Considerado APTO',
      ]),
    );
    const r = extractAso(text, HOJE);
    expect(r.validityDate).toBeUndefined();
    expect(r.validityBasis).toBe('undetermined');
  }, 30_000);

  it('um PDF sem camada de texto sai como leitura fraca (aciona a IA)', async () => {
    // Página em branco: é o que um ASO escaneado devolve ao pdfjs.
    const text = await extractPdfText(makePdf([]));
    const r = extractAso(text, HOJE);
    expect(isWeakExtraction(r)).toBe(true);
    expect(r.examDate).toBeUndefined();
  }, 30_000);

  it('confere o documento contra um S-2220 divergente', async () => {
    const text = await extractPdfText(makePdf(PERIODICO_COM_VALIDADE));
    const r = extractAso(text, HOJE);
    const rec = reconcileWithEsocial(r, [
      { eventId: 'ID-S2220-1', examDate: '2026-03-10', examKind: '1', result: '2' },
    ]);
    expect(rec.matchStatus).toBe('divergent');
    expect(rec.divergences).toEqual([
      { field: 'result', label: 'Resultado', document: '1', esocial: '2' },
    ]);
  }, 30_000);
});
