/**
 * Gera um PDF de contrato VÁLIDO, com texto contratual real.
 *
 * Por que isto existe: as suítes E2E vinham anexando
 * `Buffer.from('%PDF-1.4\n% contrato e2e\n')` — que não é um PDF, é o cabeçalho
 * dele. Servia para exercitar upload e versionamento, mas fazia TODA extração
 * de cláusulas cair no ramo de falha, e por isso o caminho de SUCESSO da rota
 * de análise nunca era executado. A auditoria `contract.clauses_extracted`, que
 * só existe nesse ramo, jamais chegou a ser escrita.
 *
 * O arquivo aqui é um PDF mínimo porém legítimo: catálogo, página, fonte,
 * stream de conteúdo com operadores de texto e uma tabela xref com offsets
 * reais. Sem compressão, de propósito — o objetivo é ser lido, não ser pequeno.
 *
 * O texto são cláusulas de verdade, com número, valor e prazo, porque o portão
 * de evidência (migration 093) exige página e trecho literal para aceitar
 * qualquer proposta. Um lorem ipsum passaria pelo parser e seria recusado pelo
 * portão — que é o comportamento correto dele.
 */

/** Escapa os caracteres que têm significado sintático dentro de uma string PDF. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * Converte para Latin-1, que é o que a codificação padrão do Helvetica entende.
 * Acento fora dessa faixa viraria byte inválido no stream.
 */
const latin1 = (s) => Buffer.from(s, 'latin1');

export function makeContractPdf(lines) {
  const leading = 16;
  const body = lines
    .map((l, i) => (i === 0 ? `(${esc(l)}) Tj` : `T* (${esc(l)}) Tj`))
    .join('\n');
  const content = `BT\n/F1 11 Tf\n${leading} TL\n56 780 Td\n${body}\nET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
      + '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${latin1(content).length} >>\nstream\n${content}endstream`,
  ];

  // Montagem com offsets reais: a xref precisa apontar para o byte exato de
  // cada objeto, senão leitores estritos recusam o arquivo inteiro.
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(latin1(pdf).length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = latin1(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`;

  return latin1(pdf);
}

/** Cláusulas com número, valor e prazo — material que o portão de evidência aceita. */
export const QA_CONTRACT_LINES = [
  'CONTRATO DE PRESTACAO DE SERVICOS DE MANUTENCAO INDUSTRIAL',
  'Contrato no QA-FIXTURE-001',
  '',
  'CONTRATANTE: Insight Energy Ltda.',
  'CONTRATADA: Fornecedor QA Ltda.',
  '',
  'CLAUSULA 5a - DO PAGAMENTO',
  'O pagamento sera efetuado em ate 30 (trinta) dias corridos contados da',
  'data de aprovacao do boletim de medicao pela CONTRATANTE, mediante',
  'apresentacao da nota fiscal correspondente.',
  '',
  'CLAUSULA 8a - DA MULTA POR ATRASO',
  'O atraso na execucao dos servicos sujeitara a CONTRATADA a multa de 2%',
  '(dois por cento) sobre o valor da parcela em atraso, por mes de atraso,',
  'limitada a 10% (dez por cento) do valor total do contrato.',
  '',
  'CLAUSULA 12a - DO REAJUSTE',
  'Os precos serao reajustados anualmente pela variacao acumulada do IPCA,',
  'tendo como data-base a data de assinatura deste instrumento.',
  '',
  'CLAUSULA 15a - DA GARANTIA CONTRATUAL',
  'A CONTRATADA prestara garantia equivalente a 5% (cinco por cento) do valor',
  'total do contrato, valida por 90 (noventa) dias apos o termino da vigencia.',
  '',
  'CLAUSULA 19a - DO NIVEL DE SERVICO',
  'O tempo de atendimento a chamados criticos nao podera exceder 4 (quatro)',
  'horas, contadas da abertura do chamado.',
];
