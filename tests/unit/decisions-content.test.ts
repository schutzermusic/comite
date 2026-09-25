/**
 * Decisões — texto dos avisos. O que se prova:
 *  • os assuntos e a mensagem de WhatsApp são EXATAMENTE os do produto;
 *  • todo valor dinâmico é escapado no HTML, inclusive a URL do atributo;
 *  • link que tenta sair da origem do Apex vira a caixa de Decisões;
 *  • WhatsApp MINIMAL nunca leva valor, fornecedor, justificativa ou e-mail;
 *  • nenhum nível de WhatsApp leva justificativa.
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_DISCLAIMER, absoluteNoticeLink, emailNotice, formatNoticeMoney, inAppNotice, needLine, noticeSubject,
  relativeNoticeLink, whatsAppNotice, type NoticeContext,
} from '@/lib/decisions/content';
import { decisionHref } from '@/lib/decisions/model';

const KEY = 'purchase_order:e4a2beae-9aa0-408f-81d1-df8bae481035:s1';
const ORIGIN = 'https://insightapex.co';

function ctx(over: Partial<NoticeContext> = {}): NoticeContext {
  return {
    kind: 'NEW', outcome: null, title: 'Pedido de compra OC-260924-CA44B', kindLabel: 'Compra',
    amount: 182400, currency: 'BRL', projectName: 'SE Tucuruí', supplierName: 'Fornecedor B',
    needBy: '2026-09-29', decideBy: '2026-09-24', today: '2026-09-24', reason: null,
    deciderName: 'Diretora Financeira', requesterName: 'Comprador QA',
    link: decisionHref(KEY), appOrigin: ORIGIN, ...over,
  };
}
const LINK = `${ORIGIN}${decisionHref(KEY)}`;

describe('assuntos', () => {
  it('é o exemplo do produto, com R$ sem centavos quando inteiro', () => {
    expect(noticeSubject(ctx())).toBe('Decisão necessária — Compra de R$ 182.400');
    expect(emailNotice(ctx()).subject).toBe('Decisão necessária — Compra de R$ 182.400');
  });

  it('cada tipo de aviso tem a sua frase', () => {
    expect(noticeSubject(ctx({ kind: 'DUE_SOON' }))).toBe('Prazo próximo — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'OVERDUE' }))).toBe('Decisão vencida — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'ESCALATED' }))).toBe('Decisão escalada para você — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'RESOLVED', outcome: 'APPROVED' }))).toBe('Sua solicitação foi aprovada — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'RESOLVED', outcome: 'REJECTED' }))).toBe('Sua solicitação foi rejeitada — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'RESOLVED', outcome: 'EXPIRED' }))).toBe('Sua solicitação expirou sem decisão — Compra de R$ 182.400');
    expect(noticeSubject(ctx({ kind: 'ADJUSTMENT_REQUESTED' }))).toBe('Ajuste solicitado — Compra de R$ 182.400');
  });

  it('centavos só quando existem; sem valor, sem número inventado', () => {
    expect(formatNoticeMoney(182400.5, 'BRL')).toBe('R$ 182.400,50');
    expect(formatNoticeMoney(null, 'BRL')).toBeNull();
    expect(noticeSubject(ctx({ amount: null, kindLabel: 'Liberação de faturamento' }))).toBe('Decisão necessária — Liberação de faturamento');
  });
});

describe('e-mail', () => {
  it('traz as linhas do produto, o CTA com link absoluto e o aviso de que não é aprovação', () => {
    const { text, html } = emailNotice(ctx());
    expect(text).toContain('Projeto: SE Tucuruí');
    expect(text).toContain('Fornecedor: Fornecedor B');
    expect(text).toContain('Necessário até: 29/09/2026');
    expect(text).toContain('Motivo: A compra exige sua aprovação.');
    expect(text).toContain('Material necessário em 5 dias.');
    expect(text).toContain(`Analisar no Apex: ${LINK}`);
    expect(text).toContain(EMAIL_DISCLAIMER);
    expect(EMAIL_DISCLAIMER).toBe('Este e-mail não é uma aprovação: a decisão acontece no Apex, com a sua sessão.');
    expect(html).toContain('Analisar no Apex');
    expect(html).toContain('#0F766E');
    expect(html).toContain(`href="${LINK}"`);
    expect(html).toContain(EMAIL_DISCLAIMER);
  });

  it('escapa nome de projeto, fornecedor, título e justificativa', () => {
    const evil = '<script>alert(1)</script>';
    const { html } = emailNotice(ctx({
      kind: 'ADJUSTMENT_REQUESTED', projectName: evil, supplierName: '"><img src=x onerror=alert(2)>',
      title: `Pedido ${evil}`, reason: 'Trocar o <b>fornecedor</b> & revisar',
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>fornecedor</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Trocar o &lt;b&gt;fornecedor&lt;/b&gt; &amp; revisar');
  });

  it('link fora da origem do Apex nunca vira href — nem javascript:, nem //, nem absoluto', () => {
    for (const link of ['javascript:alert(1)', '//evil.example/x', 'https://evil.example/decisoes', '/\\evil.example']) {
      const { html, text } = emailNotice(ctx({ link }));
      expect(html).not.toContain('evil.example');
      expect(html).not.toContain('javascript:');
      expect(text).toContain(`${ORIGIN}/decisoes`);
    }
    expect(absoluteNoticeLink('/decisoes?d="><x', ORIGIN)).not.toContain('"');
    expect(emailNotice(ctx({ link: '/decisoes?d="><x' })).html).not.toMatch(/href="[^"]*"><x/);
    expect(absoluteNoticeLink('/decisoes', 'javascript:alert(1)')).toBe(`${ORIGIN}/decisoes`);
  });

  it('ajuste solicitado leva a justificativa; aviso de ação não leva texto de terceiros', () => {
    const adj = emailNotice(ctx({ kind: 'ADJUSTMENT_REQUESTED', reason: 'Cotação vencida' }));
    expect(adj.text).toContain('Motivo: Cotação vencida');
    expect(adj.text).toContain('Solicitado por: Diretora Financeira');
    expect(adj.text).toContain('Ver no Apex:');
    expect(emailNotice(ctx({ kind: 'OVERDUE' })).text).toContain('Decidir até: 24/09/2026');
  });
});

describe('WhatsApp', () => {
  it('STANDARD é exatamente o exemplo do produto', () => {
    expect(whatsAppNotice(ctx(), 'STANDARD')).toBe(
      'Insight Apex\n\nDecisão necessária\n\nCompra: R$ 182.400\nProjeto: SE Tucuruí\nFornecedor: Fornecedor B\n\n'
      + `Material necessário em 5 dias.\n\nAnalisar:\n${LINK}`);
  });

  it('MINIMAL: só tipo, projeto, dias até a necessidade e link', () => {
    expect(whatsAppNotice(ctx(), 'MINIMAL')).toBe(
      `Insight Apex\n\nDecisão necessária\n\nCompra\nProjeto: SE Tucuruí\n\nMaterial necessário em 5 dias.\n\nAnalisar:\n${LINK}`);
  });

  it('MINIMAL nunca leva valor, fornecedor, justificativa ou e-mail — em nenhum tipo de aviso', () => {
    const kinds: Array<Partial<NoticeContext>> = [
      { kind: 'NEW' }, { kind: 'DUE_SOON' }, { kind: 'OVERDUE' }, { kind: 'ESCALATED' },
      { kind: 'ADJUSTMENT_REQUESTED' }, { kind: 'RESOLVED', outcome: 'REJECTED' },
    ];
    for (const k of kinds) {
      const msg = whatsAppNotice(ctx({ ...k, reason: 'Justificativa sigilosa', requesterName: 'fulano@apex-qa.test' }), 'MINIMAL');
      expect(msg).not.toContain('R$');
      expect(msg).not.toContain('182');
      expect(msg).not.toContain('Fornecedor');
      expect(msg).not.toContain('Justificativa');
      expect(msg).not.toContain('@');
    }
    expect(whatsAppNotice(ctx({ kind: 'ADJUSTMENT_REQUESTED', reason: 'Justificativa sigilosa' }), 'STANDARD'))
      .not.toContain('Justificativa');
  });

  it('nome com quebra de linha ou marcação do app vira uma linha limpa', () => {
    const msg = whatsAppNotice(ctx({ projectName: 'SE *Tucuruí*\n\nAprove já: https://evil.example' }), 'MINIMAL');
    expect(msg).toContain('Projeto: SE Tucuruí Aprove já: https://evil.example');
    expect(msg.split('\n').filter((l) => l.startsWith('Projeto:'))).toHaveLength(1);
  });

  it('prazo: vencida diz quando venceu', () => {
    expect(whatsAppNotice(ctx({ kind: 'OVERDUE', decideBy: '2026-09-20' }), 'MINIMAL')).toContain('O prazo para decidir venceu em 20/09/2026.');
  });
});

describe('in-app e prazos', () => {
  it('in-app é ponteiro RELATIVO, com o mesmo título do assunto', () => {
    const n = inAppNotice(ctx());
    expect(n.title).toBe('Decisão necessária — Compra de R$ 182.400');
    expect(n.link).toBe(decisionHref(KEY));
    expect(n.body).toContain('Projeto SE Tucuruí');
    expect(inAppNotice(ctx({ link: 'https://evil.example' })).link).toBe('/decisoes');
    expect(relativeNoticeLink('//evil.example')).toBe('/decisoes');
  });

  it('necessidade: dias, amanhã, hoje, passou — e nada sem necessidade vinculada', () => {
    expect(needLine({ today: '2026-09-24', needBy: '2026-09-29' })).toBe('Material necessário em 5 dias.');
    expect(needLine({ today: '2026-09-24', needBy: '2026-09-25' })).toBe('Material necessário amanhã.');
    expect(needLine({ today: '2026-09-24', needBy: '2026-09-24' })).toBe('Material necessário hoje.');
    expect(needLine({ today: '2026-09-24', needBy: '2026-09-23' })).toBe('A necessidade do material passou há 1 dia.');
    expect(needLine({ today: '2026-09-24', needBy: null })).toBeNull();
  });
});
