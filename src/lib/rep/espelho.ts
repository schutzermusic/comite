/**
 * Espelho de ponto mensal (Portaria 671) — documento impresso por
 * trabalhador/competência com todas as marcações (NSR + hash), totais
 * diários (trabalhadas, extras, noturno, saldo) e campos de assinatura.
 * Reaproveita o motor de jornada derivada (journey.ts).
 */
import type { AttendancePunch, DayJourney, Person, RepSettings } from '@/lib/types/people';
import { PUNCH_TYPE_LABELS } from '@/lib/types/people';

function fmtMin(min: number): string {
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(min);
  return `${sign}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}

function fmtCpf(cpf: string | null): string {
  if (!cpf || cpf.length !== 11) return cpf ?? '—';
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function fmtCnpj(id: string, type: 'cnpj' | 'cpf'): string {
  const d = id.replace(/\D/g, '');
  if (type === 'cpf') return fmtCpf(d);
  if (d.length !== 14) return id || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildEspelhoHtml(
  settings: RepSettings,
  person: Person,
  month: string,
  journeys: DayJourney[],
  punches: AttendancePunch[],
): { html: string; recordCount: number } {
  const [y, m] = month.split('-').map(Number);
  const monthLabel = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });

  const totals = journeys.reduce(
    (acc, j) => ({
      worked: acc.worked + j.workedMinutes,
      overtime: acc.overtime + j.overtimeMinutes,
      night: acc.night + j.nightMinutes,
      balance: acc.balance + j.balanceMinutes,
    }),
    { worked: 0, overtime: 0, night: 0, balance: 0 },
  );

  const rows = journeys
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((j) => {
      const marks = j.punches
        .map((p) => `${fmtTime(p.occurredAt)} ${PUNCH_TYPE_LABELS[p.type].split(' ')[0]}${p.nsr != null ? ` <span class="muted">(NSR ${p.nsr})</span>` : ''}`)
        .join(' · ');
      const [, mm, dd] = j.date.split('-');
      return `<tr>
        <td>${dd}/${mm}</td>
        <td>${marks || '—'}</td>
        <td style="text-align:right">${fmtMin(j.workedMinutes)}</td>
        <td style="text-align:right">${fmtMin(j.expectedMinutes)}</td>
        <td style="text-align:right">${j.overtimeMinutes > 0 ? fmtMin(j.overtimeMinutes) : '—'}</td>
        <td style="text-align:right">${j.nightMinutes > 0 ? fmtMin(j.nightMinutes) : '—'}</td>
        <td style="text-align:right">${fmtMin(j.balanceMinutes)}</td>
        <td>${j.incomplete ? 'Incompleta' : 'OK'}</td>
      </tr>`;
    })
    .join('');

  const firstNsr = punches.filter((p) => p.nsr != null).map((p) => p.nsr as number);
  const nsrRange = firstNsr.length
    ? `${Math.min(...firstNsr)} – ${Math.max(...firstNsr)}`
    : '—';

  const html = `
  <h1>Espelho de Ponto — ${monthLabel}</h1>
  <p class="muted">${settings.employerName || 'Empregador'} · ${settings.employerIdType.toUpperCase()} ${fmtCnpj(settings.employerId, settings.employerIdType)}</p>
  <h2>Trabalhador</h2>
  <p>${person.fullName} · CPF ${fmtCpf(person.cpf)} · Jornada contratual ${person.weeklyHours}h/semana</p>
  <table>
    <thead><tr>
      <th>Dia</th><th>Marcações</th><th>Trabalhadas</th><th>Prevista</th>
      <th>HE</th><th>Noturno</th><th>Saldo</th><th>Situação</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="8">Sem marcações na competência.</td></tr>'}</tbody>
    <tfoot><tr>
      <th colspan="2">Totais</th>
      <th style="text-align:right">${fmtMin(totals.worked)}</th><th></th>
      <th style="text-align:right">${fmtMin(totals.overtime)}</th>
      <th style="text-align:right">${fmtMin(totals.night)}</th>
      <th style="text-align:right">${fmtMin(totals.balance)}</th><th></th>
    </tr></tfoot>
  </table>
  <p class="muted">NSR no período: ${nsrRange} · Marcações imutáveis com hash SHA-256 encadeado (Portaria 671). Correções geram novo registro vinculado ao original.</p>
  <div class="sign">
    <div>Assinatura do trabalhador</div>
    <div>Assinatura do empregador/preposto</div>
  </div>`;

  return { html, recordCount: journeys.reduce((s, j) => s + j.punches.length, 0) };
}
