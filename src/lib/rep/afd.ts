/**
 * AFD — Arquivo-Fonte de Dados do REP-P (Portaria 671/2021).
 * Gera o arquivo texto com cabeçalho (tipo 1), marcações de ponto do
 * REP-P (tipo 7, com CPF + hash SHA-256 encadeado vindo do banco) e
 * trailer (tipo 9), em linhas de largura fixa terminadas em CRLF.
 *
 * ⚠️ HOMOLOGAÇÃO: a estrutura segue o desenho da Portaria 671 (NSR
 * sequencial, CPF como chave, hash por marcação, contadores no trailer),
 * mas o layout byte a byte DEVE ser validado contra o Anexo oficial e o
 * processo de atestado técnico antes do uso fiscal. A assinatura
 * ICP-Brasil do arquivo (certificado do empregador) é acoplada na
 * homologação — aqui registramos o SHA-256 do arquivo na trilha
 * rep_file_exports.
 */
import type { AttendancePunch, RepSettings } from '@/lib/types/people';

const CRLF = '\r\n';

/* ────────────────────────── helpers ─────────────────────────── */

const stripDiacritics = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** ASCII, corta/preenche à direita com espaço. */
const alpha = (value: string | null | undefined, len: number) =>
  stripDiacritics(value ?? '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .slice(0, len)
    .padEnd(len, ' ');

/** Somente dígitos, corta/preenche à esquerda com zero. */
const num = (value: string | number | null | undefined, len: number) =>
  String(value ?? '')
    .replace(/\D/g, '')
    .slice(-len)
    .padStart(len, '0');

/** ISO 8601 local com offset (24 chars): yyyy-MM-ddTHH:mm:00-0300 */
function isoLocal(iso: string, timezone: string): string {
  const d = new Date(iso);
  // formata no fuso configurado
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'longOffset',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const rawOffset = get('timeZoneName'); // ex.: GMT-03:00
  const offset = rawOffset.replace('GMT', '').replace(':', '') || '-0300';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

const ddmmaaaa = (dateIso: string) => {
  const [y, m, d] = dateIso.slice(0, 10).split('-');
  return `${d}${m}${y}`;
};

/* ────────────────────────── builder ─────────────────────────── */

export interface AfdResult {
  content: string;
  fileName: string;
  recordCount: number;
  skippedWithoutCpf: number;
}

/**
 * Monta o AFD do período. `punches` deve vir com `person` populado
 * (CPF) e apenas marcações com NSR atribuído pelo banco. Marcações de
 * pessoas sem CPF são contadas em `skippedWithoutCpf` (cadastre o CPF
 * em Pessoas antes do uso fiscal).
 */
export function buildAfd(
  settings: RepSettings,
  punches: AttendancePunch[],
  periodStart: string,
  periodEnd: string,
): AfdResult {
  const now = new Date().toISOString();
  const lines: string[] = [];

  const eligible = punches
    .filter((p) => p.nsr != null && p.integrityHash && p.person?.cpf)
    .sort((a, b) => (a.nsr ?? 0) - (b.nsr ?? 0));
  const skippedWithoutCpf = punches.filter((p) => p.nsr != null && !p.person?.cpf).length;

  // ── Registro tipo 1 — cabeçalho ──
  // NSR(9)=zeros | tipo(1)='1' | tpIdtEmpregador(1): 1=CNPJ 2=CPF |
  // idtEmpregador(14) | CEI/CAEPF/CNO(14) | razão social(150) |
  // data inicial(8 ddmmaaaa) | data final(8) | geração(12 ddmmaaaahhmm) |
  // versão layout(3)='003' | idtDesenvolvedor(14) | nome desenvolvedor(150) |
  // versão REP-P(20)
  const genDate = ddmmaaaa(now);
  const genTime = new Date(now).toISOString().slice(11, 16).replace(':', '');
  lines.push(
    '0'.repeat(9) +
      '1' +
      (settings.employerIdType === 'cnpj' ? '1' : '2') +
      num(settings.employerId, 14) +
      num(settings.employerCei ?? '', 14) +
      alpha(settings.employerName, 150) +
      ddmmaaaa(periodStart) +
      ddmmaaaa(periodEnd) +
      genDate +
      genTime +
      '003' +
      num(settings.developerId, 14) +
      alpha(settings.developerName, 150) +
      alpha(settings.repPVersion, 20),
  );

  // ── Registros tipo 7 — marcação de ponto REP-P ──
  // NSR(9) | tipo(1)='7' | dataHoraMarcacao(24 ISO c/ offset) | CPF(12) |
  // dataHoraGravacao(24) | coletor(2)='01' | online(1) O/F | hash(64)
  for (const p of eligible) {
    lines.push(
      num(p.nsr, 9) +
        '7' +
        isoLocal(p.occurredAt, settings.timezone) +
        num(p.person!.cpf!, 12) +
        isoLocal(p.receivedAt ?? p.occurredAt, settings.timezone) +
        '01' +
        (p.source === 'mobile' && p.clientEventId ? 'F' : 'O') +
        (p.integrityHash ?? '').padEnd(64, '0'),
    );
  }

  // ── Registro tipo 9 — trailer com contadores por tipo (2..7) ──
  lines.push(
    '9'.repeat(9) +
      '9' +
      num(0, 9) + // tipo 2
      num(0, 9) + // tipo 3
      num(0, 9) + // tipo 4
      num(0, 9) + // tipo 5
      num(0, 9) + // tipo 6
      num(eligible.length, 9), // tipo 7
  );

  const content = lines.join(CRLF) + CRLF;
  const fileName = `AFD_${num(settings.employerId, 14)}_REP_P_${periodStart.replace(/-/g, '')}_${periodEnd.replace(/-/g, '')}.txt`;

  return { content, fileName, recordCount: eligible.length, skippedWithoutCpf };
}
