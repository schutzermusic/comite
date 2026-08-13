import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { resolvePayrollActor } from '@/lib/payroll/repository/actor';
import {
  EsocialSchemaMissingError,
  readEmployments,
  readSstEvents,
} from '@/lib/esocial/connector/store';
import type { SstEvent, SstWorker } from '@/lib/workforce/sst';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SST do eSocial para a seção "SST / ASO & CAT".
 *
 * Devolve uma linha por evento (S-2210, S-2220, S-2240) — e não agregados —
 * porque as perguntas desta seção são sobre o indivíduo e sobre o evento:
 * "quem está sem ASO válido", "qual agente, em que ambiente". Agregar aqui
 * destruiria a pergunta.
 *
 * NOMES SÃO DADO SENSÍVEL. Estes eventos carregam saúde ocupacional e
 * acidente: quem tem apenas `people.view` recebe os fatos, as áreas e as
 * contagens, mas não os nomes nem a máscara de CPF. O identificador de
 * trabalhador que atravessa em qualquer caso é pseudônimo — serve para agrupar
 * e para ligar exame a vínculo, e não identifica ninguém sozinho.
 */
export async function GET(req: Request) {
  const r = await resolvePayrollActor('people.view');
  if (!r.ok) return r.response;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from') ?? undefined;

  // A identificação nominal exige a permissão de dado sensível do módulo.
  const supabase = await createClient();
  const { data: canSeeNames } = await supabase.rpc('current_user_has_permission', {
    permission_key: 'people.view_sensitive_data',
  });
  const identified = canSeeNames === true;

  let rows;
  let employments;
  try {
    [rows, employments] = await Promise.all([
      readSstEvents(r.actor.organizationId, { fromCompetence: from }),
      readEmployments(r.actor.organizationId, { status: 'active' }),
    ]);
  } catch (err) {
    // Base sem a migration 084: a seção deve dizer que não há acervo, não
    // quebrar. É o mesmo tratamento que o resto do conector dá.
    if (err instanceof EsocialSchemaMissingError) {
      return NextResponse.json({
        ok: true,
        available: false,
        identified,
        events: [],
        workers: [],
        message: 'A apuração de SST ainda não foi provisionada nesta base.',
      });
    }
    throw err;
  }

  const events: SstEvent[] = rows.map((row) => {
    const base: SstEvent = {
      eventId: row.esocial_event_id,
      eventType: row.event_type,
      competence: row.competence,
      eventDate: row.event_date,
      workerKey: row.worker_cpf_hash ?? row.matricula ?? null,
      workerName: identified ? row.worker_name : null,
      workerMask: identified ? row.worker_cpf_mask : null,
      matricula: identified ? row.matricula : null,
      areaCode: row.area_code,
      areaLabel: row.area_label,
    };

    if (row.event_type === 'S-2210') {
      base.cat = {
        catType: row.cat_type,
        accidentKind: row.accident_kind,
        localKind: row.local_kind,
        situationCode: row.situation_code,
        initiator: row.initiator,
        causedLeave: row.caused_leave,
        deathDate: row.death_date,
        bodyPartCode: row.body_part_code,
        causingAgentCode: row.causing_agent_code,
      };
    } else if (row.event_type === 'S-2220') {
      base.aso = {
        examKind: row.exam_kind,
        result: row.exam_result,
        validUntil: row.aso_valid_until,
        periodMonths: row.aso_period_months,
        exams: row.exams ?? [],
      };
    } else {
      base.exposure = {
        start: row.exposure_start,
        end: row.exposure_end,
        environmentCode: row.environment_code,
        agents: row.agents ?? [],
      };
    }

    return base;
  });

  // O quadro ativo é o denominador de "sem ASO válido": quem nunca fez exame
  // não tem evento e só aparece por aqui.
  const workers: SstWorker[] = employments.map((e) => ({
    workerKey: e.worker_cpf_hash ?? e.matricula,
    name: identified ? (e.worker_name ?? null) : null,
    matricula: identified ? e.matricula : null,
    areaLabel: e.area_label ?? null,
  }));

  return NextResponse.json({ ok: true, available: true, identified, events, workers });
}
