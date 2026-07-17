/**
 * Comprovante de registro de ponto (Portaria 671) — emitido ao
 * trabalhador a cada marcação: empregador, trabalhador (CPF), data/hora,
 * NSR e hash de integridade.
 */
import type { AttendancePunch, RepSettings } from '@/lib/types/people';
import { PUNCH_TYPE_LABELS } from '@/lib/types/people';

function fmtCpf(cpf: string | null | undefined): string {
  if (!cpf || cpf.length !== 11) return cpf ?? '—';
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function buildComprovanteHtml(settings: RepSettings, punch: AttendancePunch): string {
  const when = new Date(punch.occurredAt).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: settings.timezone,
  });
  return `
  <h1>Comprovante de Registro de Ponto</h1>
  <p class="muted">REP-P · ${settings.developerName} v${settings.repPVersion}</p>
  <h2>Empregador</h2>
  <p>${settings.employerName || '—'}<br/>${settings.employerIdType.toUpperCase()}: ${settings.employerId || '—'}</p>
  <h2>Trabalhador</h2>
  <p>${punch.person?.fullName ?? '—'}<br/>CPF: ${fmtCpf(punch.person?.cpf)}</p>
  <h2>Marcação</h2>
  <table>
    <tr><th>Tipo</th><td>${PUNCH_TYPE_LABELS[punch.type]}</td></tr>
    <tr><th>Data/hora</th><td>${when} (${settings.timezone})</td></tr>
    <tr><th>NSR</th><td>${punch.nsr ?? '—'}</td></tr>
    <tr><th>Origem</th><td>${punch.source}</td></tr>
    <tr><th>Hash SHA-256</th><td class="mono">${punch.integrityHash ?? '—'}</td></tr>
  </table>
  <p class="muted">Registro imutável — correções geram novo registro vinculado (Portaria 671).</p>`;
}
