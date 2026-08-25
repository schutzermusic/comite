'use client';

/**
 * WRITEBACK autônomo de sessões reconstruídas (P3B).
 *
 * Único ponto do sistema onde automação escreve em tabela operacional. O motor
 * de casamento e os selectors continuam puros e sem efeito colateral — quem
 * decide agir é `execution-policy.ts`, e quem age é este arquivo.
 *
 * ─── Decidir → Agir → Verificar ────────────────────────────────────────────
 * Um INSERT bem-sucedido não é sucesso. Depois de gravar, relê a linha e
 * confere: a etapa existe, o intervalo é coerente, não há duplicata, a
 * proveniência bate. Falhou a verificação ⇒ a sessão é marcada `failed` e vira
 * exceção humana, em vez de ficar circulando como se fosse fato apurado.
 *
 * ─── Segurança ─────────────────────────────────────────────────────────────
 * Tudo passa pelo cliente autenticado do usuário e pela RLS de 041/097. Não há
 * service role: quem não tem `people.timesheet_approve` simplesmente não
 * consegue gravar sessão de terceiro, e o INSERT falha — como deve.
 */

import { createClient } from '@/utils/supabase/client';
import { logAuditEvent } from '@/lib/audit/log-audit-event';
import {
  automationKeyFor,
  type ReconstructedSegment,
} from '@/lib/projects/session-reconstruction';
import { evaluateAutomation, type PolicyVerdict } from '@/lib/projects/execution-policy';
import type { EvidenceMatch } from '@/lib/projects/execution-matching';

const SESSIONS = 'project_work_sessions';

export type WritebackOutcome =
  | 'created'
  | 'unchanged'
  | 'updated'
  | 'skipped_policy'
  | 'verification_failed'
  | 'error';

export interface WritebackResult {
  outcome: WritebackOutcome;
  sessionId: string | null;
  automationKey: string;
  verdict: PolicyVerdict;
  message: string | null;
}

export interface WritebackCandidate {
  segment: ReconstructedSegment;
  match: EvidenceMatch;
  projectId: string;
}

async function currentContext(supabase: ReturnType<typeof createClient>) {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user) throw new Error('Não autenticado');
  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('user_id', user.id)
    .single();
  if (error || !data?.organization_id) throw new Error('Usuário sem organização ativa');
  return { userId: user.id, orgId: data.organization_id as string };
}

/**
 * Grava (ou reconhece) UMA sessão reconstruída.
 *
 * Idempotente por `automation_key`: reprocessar a mesma evidência encontra a
 * linha existente e não cria outra. Se algo relevante mudou (etapa resolvida,
 * confiança), atualiza a MESMA linha em vez de clonar.
 */
export async function writeReconstructedSession(
  candidate: WritebackCandidate,
): Promise<WritebackResult> {
  const { segment, match, projectId } = candidate;
  const automationKey = automationKeyFor({
    personId: segment.personId,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    timelineItemId: match.timelineItemId,
  });

  const verdict = evaluateAutomation({ match, writeKind: 'work_session' });

  const base: WritebackResult = {
    outcome: 'skipped_policy',
    sessionId: null,
    automationKey,
    verdict,
    message: null,
  };

  // A política é soberana: só AUTO_APPLY escreve. PROPOSE/REQUIRE_HUMAN/REJECT
  // não tocam o banco — viram sinal na UI e exceção para o gestor.
  if (verdict.decision !== 'AUTO_APPLY') return base;

  // Segmento aberto não vira sessão: sem fim não há duração defensável.
  if (segment.status !== 'complete' || !segment.endedAt || !segment.durationMinutes) {
    return { ...base, outcome: 'skipped_policy', message: 'Segmento sem fechamento observado.' };
  }

  try {
    const supabase = createClient();
    const { userId, orgId } = await currentContext(supabase);

    // 1) Já existe? Idempotência antes de qualquer escrita.
    const { data: existing } = await supabase
      .from(SESSIONS)
      .select('id, timeline_item_id, match_confidence, corrected_at, superseded_by')
      .eq('automation_key', automationKey)
      .maybeSingle();

    if (existing) {
      const row = existing as {
        id: string; timeline_item_id: string | null; match_confidence: number | null;
        corrected_at: string | null; superseded_by: string | null;
      };
      // Correção humana é soberana: automação não volta atrás por cima dela.
      if (row.corrected_at || row.superseded_by) {
        return { ...base, outcome: 'unchanged', sessionId: row.id, message: 'Sessão corrigida por pessoa; automação não sobrescreve.' };
      }
      const sameItem = row.timeline_item_id === match.timelineItemId;
      const sameConfidence = Number(row.match_confidence ?? 0) === match.confidence;
      if (sameItem && sameConfidence) {
        return { ...base, outcome: 'unchanged', sessionId: row.id };
      }
      const { error: updErr } = await supabase
        .from(SESSIONS)
        .update({
          timeline_item_id: match.timelineItemId,
          match_confidence: match.confidence,
          resolution_method: match.reasonCodes.join(','),
          evidence_ids: segment.evidenceIds,
          reconstructed_at: new Date().toISOString(),
          verification_status: 'pending',
        })
        .eq('id', row.id);
      if (updErr) return { ...base, outcome: 'error', sessionId: row.id, message: updErr.message };

      const verified = await verifySession(row.id);
      return {
        ...base,
        outcome: verified.ok ? 'updated' : 'verification_failed',
        sessionId: row.id,
        message: verified.message,
      };
    }

    // 2) Grava.
    const { data: inserted, error } = await supabase
      .from(SESSIONS)
      .insert({
        organization_id: orgId,
        person_id: segment.personId,
        project_id: projectId,
        timeline_item_id: match.timelineItemId,
        started_at: segment.startedAt,
        ended_at: segment.endedAt,
        duration_minutes: segment.durationMinutes,
        // Atribuição honesta: não se disfarça de ajuste de gestor.
        source: 'apex_reconstruction',
        // `consolidated` evita colidir com o índice de "um timer rodando".
        status: 'consolidated',
        description: 'Sessão reconstruída automaticamente a partir do ponto',
        resolution_method: match.reasonCodes.join(','),
        match_confidence: match.confidence,
        evidence_ids: segment.evidenceIds,
        automation_key: automationKey,
        reconstructed_at: new Date().toISOString(),
        verification_status: 'pending',
        created_by: userId,
      })
      .select('id')
      .single();

    // Corrida entre duas abas/execuções: a chave única resolve, e o resultado
    // correto é "já existe", não erro.
    if (error?.code === '23505') {
      return { ...base, outcome: 'unchanged', message: 'Sessão já registrada por outra execução.' };
    }
    if (error || !inserted) {
      return { ...base, outcome: 'error', message: error?.message ?? 'Falha ao gravar sessão' };
    }

    const sessionId = (inserted as { id: string }).id;

    // 3) Verifica.
    const verified = await verifySession(sessionId);

    await logAuditEvent({
      organizationId: orgId,
      action: verified.ok ? 'apex.session_reconstructed' : 'apex.session_verification_failed',
      entityType: 'project_work_session',
      entityId: sessionId,
      metadata: {
        projectId,
        timelineItemId: match.timelineItemId,
        confidence: match.confidence,
        reasonCodes: match.reasonCodes,
        evidenceIds: segment.evidenceIds,
        automationKey,
      },
    });

    return {
      ...base,
      outcome: verified.ok ? 'created' : 'verification_failed',
      sessionId,
      message: verified.message,
    };
  } catch (e) {
    return { ...base, outcome: 'error', message: e instanceof Error ? e.message : 'Erro inesperado' };
  }
}

/**
 * Verificação pós-escrita. Relê a linha e confirma que ela se sustenta.
 *
 * Grava o resultado na própria sessão: `verified` entra nos read-models de
 * execução; `failed` fica de fora e vira exceção para revisão humana.
 */
export async function verifySession(sessionId: string): Promise<{ ok: boolean; message: string | null }> {
  const supabase = createClient();
  const problems: string[] = [];

  const { data, error } = await supabase
    .from(SESSIONS)
    .select('id, person_id, project_id, timeline_item_id, started_at, ended_at, duration_minutes, automation_key, evidence_ids')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) return { ok: false, message: 'Sessão não encontrada após a escrita.' };
  const row = data as {
    id: string; person_id: string; project_id: string; timeline_item_id: string | null;
    started_at: string; ended_at: string | null; duration_minutes: number | null;
    automation_key: string | null; evidence_ids: unknown;
  };

  // Coerência interna do intervalo.
  if (!row.ended_at) problems.push('sessão sem término');
  if (row.ended_at && new Date(row.ended_at) <= new Date(row.started_at)) {
    problems.push('término anterior ao início');
  }
  if (row.ended_at && row.duration_minutes != null) {
    const expected = Math.round(
      (new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60000,
    );
    if (expected !== row.duration_minutes) problems.push('duração incoerente com o intervalo');
  }

  // A etapa referenciada ainda existe e pertence ao mesmo projeto?
  if (row.timeline_item_id) {
    const { data: item } = await supabase
      .from('project_timeline_items')
      .select('id, project_id, is_active')
      .eq('id', row.timeline_item_id)
      .maybeSingle();
    const it = item as { project_id: string; is_active: boolean } | null;
    if (!it) problems.push('etapa referenciada não existe');
    else if (!it.is_active) problems.push('etapa desativada');
    else if (it.project_id !== row.project_id) problems.push('etapa de outro projeto');
  }

  // Proveniência: sessão de automação sem evidência de origem é inauditável.
  const evidenceIds = Array.isArray(row.evidence_ids) ? row.evidence_ids : [];
  if (evidenceIds.length === 0) problems.push('sem evidência de origem');

  // Duplicata: mesmo intervalo, mesma pessoa, outra linha.
  const { data: dupes } = await supabase
    .from(SESSIONS)
    .select('id')
    .eq('person_id', row.person_id)
    .eq('started_at', row.started_at)
    .neq('id', row.id)
    .limit(1);
  if ((dupes ?? []).length > 0) problems.push('já existe sessão no mesmo início');

  const ok = problems.length === 0;
  await supabase
    .from(SESSIONS)
    .update({
      verification_status: ok ? 'verified' : 'failed',
      verification_note: ok ? null : problems.join('; '),
      verified_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  return { ok, message: ok ? null : problems.join('; ') };
}

/**
 * Correção humana. NÃO apaga a versão do Apex: marca-a como substituída e
 * registra autor, momento e motivo — a trilha "Apex resolveu X, humano
 * corrigiu para Y" é o insumo de qualquer aprendizado futuro.
 */
export async function correctSession(input: {
  sessionId: string;
  newTimelineItemId: string | null;
  note?: string;
}): Promise<void> {
  const supabase = createClient();
  const { userId, orgId } = await currentContext(supabase);

  const { data: before } = await supabase
    .from(SESSIONS)
    .select('timeline_item_id, match_confidence, resolution_method')
    .eq('id', input.sessionId)
    .maybeSingle();

  const { error } = await supabase
    .from(SESSIONS)
    .update({
      timeline_item_id: input.newTimelineItemId,
      corrected_by: userId,
      corrected_at: new Date().toISOString(),
      correction_note: input.note ?? null,
      // A partir daqui a linha é verdade humana; a automação não a revisita.
      verification_status: 'verified',
      verification_note: 'Corrigida manualmente',
    })
    .eq('id', input.sessionId);
  if (error) throw new Error(error.message);

  await logAuditEvent({
    organizationId: orgId,
    action: 'apex.session_corrected',
    entityType: 'project_work_session',
    entityId: input.sessionId,
    metadata: {
      apexResolved: (before as { timeline_item_id?: string } | null)?.timeline_item_id ?? null,
      apexConfidence: (before as { match_confidence?: number } | null)?.match_confidence ?? null,
      apexMethod: (before as { resolution_method?: string } | null)?.resolution_method ?? null,
      humanCorrectedTo: input.newTimelineItemId,
      note: input.note ?? null,
    },
  });
}

/** Sessões escritas pelo Apex neste projeto — base das métricas e da revisão. */
export async function listApexSessions(projectId: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from(SESSIONS)
      .select('id, person_id, timeline_item_id, started_at, ended_at, duration_minutes, match_confidence, resolution_method, verification_status, verification_note, corrected_at, evidence_ids')
      .eq('project_id', projectId)
      .eq('source', 'apex_reconstruction')
      .order('started_at', { ascending: false })
      .limit(500);
    if (error) return [];
    return (data ?? []) as {
      id: string; person_id: string; timeline_item_id: string | null;
      started_at: string; ended_at: string | null; duration_minutes: number | null;
      match_confidence: number | null; resolution_method: string | null;
      verification_status: string | null; verification_note: string | null;
      corrected_at: string | null; evidence_ids: unknown;
    }[];
  } catch {
    return [];
  }
}
