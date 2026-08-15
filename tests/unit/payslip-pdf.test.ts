import { describe, expect, it } from 'vitest';
import {
  aggregatePayslipLines,
  classifyPayslipRubric,
  parsePayslipPages,
  parsePayslipReference,
  type PayslipTextItem,
  type PayslipTextPage,
} from '@/lib/esocial/connector/payslip-pdf';

type FixtureLine = [code: string, description: string, reference: string, earning?: string, deduction?: string];

function item(text: string, x: number, y: number): PayslipTextItem {
  return { text, x, y };
}

function payslipBlock(top: number, lines: FixtureLine[], includeEmployee = true): PayslipTextItem[] {
  const out: PayslipTextItem[] = [];
  if (includeEmployee) {
    out.push(item('EMPRESA TESTE LTDA', 7, top));
    out.push(item('CNPJ:', 7, top - 11), item('00.000.000/0001-00', 47, top - 11));
    out.push(item('CC:', 250, top - 11), item('ENERGIA LONDRINA', 271, top - 11));
    out.push(item('Junho de 2026', 438, top - 22));
    out.push(item('Código', 19, top - 33), item('Nome do Funcionário', 51, top - 33));
    out.push(item('78', 20, top - 44), item('ANA', 51, top - 44), item('SILVA', 80, top - 44));
    out.push(item('ELETRICISTA', 51, top - 55), item('Admissão:', 369, top - 55));
  }
  const headerY = includeEmployee ? top - 73 : top;
  out.push(
    item('Código', 6, headerY), item('Descrição', 135, headerY), item('Referência', 291, headerY),
    item('Vencimentos', 370, headerY), item('Descontos', 454, headerY),
  );
  lines.forEach(([code, description, reference, earning, deduction], index) => {
    const y = headerY - 11 * (index + 1);
    out.push(item(code, 10, y), item(description, 38, y), item(reference, 320, y));
    if (earning) out.push(item(earning, 390, y));
    if (deduction) out.push(item(deduction, 475, y));
  });
  out.push(item('Total de Vencimentos', 370, headerY - 11 * (lines.length + 2)));
  return out;
}

describe('contracheque PDF provisório', () => {
  it('remove as duas vias idênticas impressas na mesma página', () => {
    const lines: FixtureLine[] = [
      ['8781', 'DIAS NORMAIS', '30,00', '2.000,00'],
      ['998', 'I.N.S.S.', '9,00', undefined, '180,00'],
    ];
    const page: PayslipTextPage = {
      pageNumber: 1,
      items: [...payslipBlock(830, lines), ...payslipBlock(420, lines)],
    };
    const parsed = parsePayslipPages([page]);
    expect(parsed).toHaveLength(2);
    expect(aggregatePayslipLines(parsed)[0]).toMatchObject({
      gross_cents: 200_000,
      deductions_cents: 18_000,
      headcount: 1,
    });
  });

  it('anexa uma página de continuação ao funcionário anterior', () => {
    const pages: PayslipTextPage[] = [
      { pageNumber: 1, items: payslipBlock(830, [['8781', 'DIAS NORMAIS', '30,00', '2.000,00']]) },
      { pageNumber: 2, items: payslipBlock(760, [['150', 'HORAS EXTRAS 50%', '1:30', '30,00']], false) },
    ];
    const parsed = parsePayslipPages(pages);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toMatchObject({ employee_code: '78', source_page: 2, semantic_category: 'overtime_50' });
  });

  it('classifica provento/desconto pela coluna e INFOR como informativa', () => {
    const page: PayslipTextPage = {
      pageNumber: 1,
      items: payslipBlock(830, [
        ['150', 'HORAS EXTRAS 50%', '1:00', '20,00'],
        ['999', 'IMPOSTO DE RENDA', '7,50', undefined, '10,00'],
        ['25', 'ADICIONAL NOTURNO (INFOR)', '2:00', '5,00'],
      ]),
    };
    const parsed = parsePayslipPages([page]);
    expect(parsed.map((line) => line.rubric_role)).toEqual(['earning', 'deduction', 'informative']);
    expect(parsed.every((line) => line.classification_basis === 'payslip_pdf')).toBe(true);
    expect(parsed.every((line) => line.natRubr === null && line.inssIncidence === null)).toBe(true);
  });

  it('converte referência HH:MM em horas decimais e soma horas extras', () => {
    expect(parsePayslipReference('1:30')).toEqual({ quantity: null, hours: 1.5 });
    const parsed = parsePayslipPages([{ pageNumber: 1, items: payslipBlock(830, [
      ['150', 'HORAS EXTRAS 50%', '1:30', '30,00'],
      ['200', 'HORAS EXTRAS 100%', '0:45', '25,00'],
      ['8125', 'REFLEXO HORAS EXTRAS DSR', '0:00', '5,00'],
    ]) }]);
    expect(aggregatePayslipLines(parsed)[0]).toMatchObject({ overtime_cents: 6_000, overtime_hours: 2.25 });
  });

  it('mantém rubrica não reconhecida em unknown', () => {
    expect(classifyPayslipRubric('VERBA ESPECIAL XYZ', 100, 0)).toEqual({ role: 'earning', category: 'unknown' });
  });
});
