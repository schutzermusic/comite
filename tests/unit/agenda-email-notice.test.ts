/**
 * Agenda e-mail: o navegador só nomeia o fato; conteúdo e destinatários são do
 * servidor. Regressão do relay (o corpo antigo {subject, html, recipients} era
 * repassado ao provedor como veio).
 */
import { describe, expect, it } from 'vitest';
import {
  AGENDA_EMAIL_ID_FIELD, NOTICE_WINDOW_MS, calendarDateLabel, isFresh, meetingDateLabel, noticeIdempotencyKey,
  noticeRecipients, parseAgendaEmailRequest,
} from '@/lib/agenda/email-notice';
import { meetingInviteEmail, safeHref, taskAssignedEmail, timelineDelayEmail } from '@/lib/agenda/email-templates';
import { buildIcs } from '@/lib/agenda/ics';
import { appNotificationHref } from '@/lib/services/agenda';

const ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';

describe('parseAgendaEmailRequest — o relay antigo é recusado', () => {
  it('recusa o corpo livre {subject, html, recipients}', () => {
    const r = parseAgendaEmailRequest({ subject: 'Oferta', html: '<a href="https://evil.example">x</a>', recipients: ['vitima@example.com'] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/servidor/);
  });

  it('recusa um aviso tipado que tente carregar conteúdo ou destinatários', () => {
    for (const extra of [{ recipients: ['x@example.com'] }, { html: '<b>x</b>' }, { subject: 'x' }, { ics: 'BEGIN:VCALENDAR' }, { from: 'ceo@banco.com' }]) {
      const r = parseAgendaEmailRequest({ kind: 'meeting_invite', event_id: ID, ...extra });
      expect(r.ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it('recusa tipo desconhecido, id ausente e id que não é UUID', () => {
    expect(parseAgendaEmailRequest({ kind: 'bulk', event_id: ID }).ok).toBe(false);
    expect(parseAgendaEmailRequest({ kind: 'meeting_invite' }).ok).toBe(false);
    expect(parseAgendaEmailRequest({ kind: 'meeting_invite', event_id: '1 OR 1=1' }).ok).toBe(false);
    expect(parseAgendaEmailRequest({ kind: 'meeting_invite', task_id: ID }).ok).toBe(false);
    expect(parseAgendaEmailRequest(null).ok).toBe(false);
    expect(parseAgendaEmailRequest([]).ok).toBe(false);
  });

  it('aceita cada aviso tipado com o seu campo de identidade', () => {
    for (const [kind, field] of Object.entries(AGENDA_EMAIL_ID_FIELD)) {
      const r = parseAgendaEmailRequest({ kind, [field]: ID });
      expect(r).toEqual({ ok: true, request: { kind, id: ID } });
    }
  });
});

describe('destinatários, janela e idempotência', () => {
  it('filtra endereço malformado (quebra de linha, aspas, vírgula), repete sem diferença de caixa e exclui quem pediu', () => {
    const r = noticeRecipients(
      ['Ana@Example.com', 'ana@example.com', 'bia@example.com\r\nBcc: x@evil.com', 'a,b@example.com', '"x"@example.com', '', null, 'caio@example.com'],
      ['CAIO@example.com'],
    );
    expect(r).toEqual(['Ana@Example.com']);
  });

  it('aviso de fato só vale logo depois do fato', () => {
    const now = Date.parse('2026-09-24T12:00:00Z');
    expect(isFresh('2026-09-24T11:45:00Z', now)).toBe(true);
    expect(isFresh(new Date(now - NOTICE_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(isFresh('2026-09-24T12:30:00Z', now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    expect(isFresh('não é data', now)).toBe(false);
  });

  it('chave estável por aviso e destinatário, sem o endereço em claro, dentro do limite do provedor', () => {
    const k1 = noticeIdempotencyKey('task_assigned', ID, 'Ana@Example.com');
    expect(k1).toBe(noticeIdempotencyKey('task_assigned', ID, 'ana@example.com '));
    expect(k1).not.toBe(noticeIdempotencyKey('task_assigned', ID, 'bia@example.com'));
    expect(k1).not.toContain('example.com');
    expect(k1.length).toBeLessThanOrEqual(256);
  });

  it('datas no fuso da operação, não no do servidor', () => {
    expect(meetingDateLabel('2026-06-12T17:00:00Z')).toMatch(/12.*jun.*2026.*14:00/);
    expect(calendarDateLabel('2026-06-12')).toMatch(/12.*jun.*2026/);
  });
});

describe('modelos do servidor — tudo escapado, link só http(s)', () => {
  it('título com HTML não vira marcação; link javascript: não vira link', () => {
    const mail = meetingInviteEmail({
      title: '<img src=x onerror=alert(1)> Revisão', dateLabel: 'qui., 12 de jun. de 2026, 14:00',
      organizerName: 'Ana "A" <ana>', meetingLink: 'javascript:alert(document.cookie)', description: '<script>x</script>',
      detailUrl: 'https://insightapex.co/reunioes?event=1',
    });
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).not.toMatch(/href="javascript:/i);
    expect(mail.html).toContain('href="https://insightapex.co/reunioes?event=1"');
    expect(mail.text).toContain('Ver reunião: https://insightapex.co/reunioes?event=1');
  });

  it('link de reunião http(s) vira link, com o atributo escapado', () => {
    const mail = meetingInviteEmail({ title: 'R', dateLabel: 'd', meetingLink: 'https://meet.example/a?b=1&c="2"' });
    expect(mail.html).toContain('href="https://meet.example/a?b=1&amp;c=%222%22"');
  });

  it('assunto é uma linha só (sem injeção de cabeçalho pelo título)', () => {
    const mail = taskAssignedEmail({ title: 'Tarefa\r\nBcc: todos@empresa.com', priority: 'high' });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('CTA sem URL segura não aparece', () => {
    const mail = timelineDelayEmail({ projectName: 'P', taskTitle: 'T', statusLabel: 'Atrasada', actionRequired: false, detailUrl: 'javascript:x' });
    expect(mail.html).not.toContain('Abrir atividade');
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('/relativo')).toBeNull();
    expect(safeHref('https://insightapex.co/x')).toBe('https://insightapex.co/x');
  });
});

describe('ICS gerado no servidor', () => {
  it('endereço com quebra de linha não injeta linha no calendário; CN entre aspas', () => {
    const ics = buildIcs({
      uid: 'u', title: 'R', start: new Date('2026-06-12T17:00:00Z'), organizerName: 'Ana: "Diretora"',
      organizerEmail: 'ana@example.com', attendees: ['bia@example.com', 'x@example.com\r\nATTENDEE:mailto:evil@evil.com'],
      url: 'javascript:alert(1)',
    });
    expect(ics).toMatch(/ORGANIZER;CN="Ana:\s+Diretora":mailto:ana@example\.com/);
    expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:bia@example.com');
    expect(ics).not.toContain('evil@evil.com');
    expect(ics).not.toContain('URL;');
  });
});

describe('link de notificação in-app', () => {
  it('só caminho relativo do app é navegável', () => {
    expect(appNotificationHref('/reunioes?task=1')).toBe('/reunioes?task=1');
    expect(appNotificationHref('//evil.example/x')).toBeNull();
    expect(appNotificationHref('/\\evil.example')).toBeNull();
    expect(appNotificationHref('https://evil.example')).toBeNull();
    expect(appNotificationHref('javascript:alert(1)')).toBeNull();
    expect(appNotificationHref(null)).toBeNull();
  });
});
