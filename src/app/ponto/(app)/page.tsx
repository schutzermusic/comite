'use client';

/**
 * Início — a tela onde o colaborador bate o ponto.
 *
 * Hierarquia: relógio e estado da jornada → ação dominante → contexto de
 * GPS/cerca/sincronização → resumo do dia → atividade e pendências. Não é
 * um painel administrativo: nada de analytics aqui.
 *
 * Fluxo preservado do portal anterior: a ENTRADA de quem tem alocação
 * abre a escolha de projeto/etapa (jornada e apontamento começam juntos),
 * e toda marcação exige uma SELFIE tirada na hora, que vira
 * authentication_evidence anexada ao ponto. A localização é capturada só
 * no evento; o veredito de área é sempre do servidor (ADR-008).
 */

import * as React from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Clock3,
  LayoutList,
  LocateFixed,
  Replace,
  RotateCcw,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { pontoApi } from '@/lib/ponto/client';
import type { ActivitySelection } from '@/hooks/use-ponto-session';
import type { PunchType, TimelineStage } from '@/lib/ponto/attendance-types';
import {
  PUNCH_SHORT_LABEL,
  computeDailySummary,
  deriveWorkdayPhase,
  effectivePunches,
  formatTime,
  lastPunchType,
  nextPunchOptions,
} from '@/lib/ponto/attendance-state';
import { INITIAL_GEOFENCE_STATE, evaluateGeofenceClient } from '@/lib/ponto/geolocation';
import { usePonto } from '@/components/ponto/PontoSessionProvider';
import {
  AttendanceActionCard,
  AttendanceErrorSheet,
  AttendanceSuccessSheet,
  AttendanceTimeline,
  CameraVerification,
  DailySummary,
  GeofenceStatus,
  LocationStatus,
  PermissionRequestCard,
  PontoButton,
  PontoCard,
  SectionLabel,
  SyncStatus,
  WorkAssignmentSheet,
  WorksiteInfoPanel,
  type AttendanceError,
  type AttendanceSuccess,
} from '@/components/ponto';

interface PunchFlow {
  stage: 'assignment' | 'selfie';
  type: PunchType;
  activity: ActivitySelection | null;
}

/** A leitura de GPS vale por 1 min; depois disso relemos antes de enviar. */
const LOCATION_FRESHNESS_MS = 60_000;

export default function PontoHomePage() {
  const { session, geo, punchFlowRequested, consumePunchFlowRequest } = usePonto();
  const {
    bootstrap,
    todayPunches,
    pending,
    online,
    syncing,
    busy,
    loadError,
    reload,
    submitPunch,
    syncNow,
    undoLastPunch,
    stopActivity,
  } = session;

  const [flow, setFlow] = React.useState<PunchFlow | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [selfieError, setSelfieError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<AttendanceSuccess | null>(null);
  const [failure, setFailure] = React.useState<AttendanceError | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [syncMessage, setSyncMessage] = React.useState<string | null>(null);

  // seleção de projeto/etapa da entrada
  const [selProject, setSelProject] = React.useState<string | null>(null);
  const [selStage, setSelStage] = React.useState<string | null>(null);
  const [stages, setStages] = React.useState<TimelineStage[]>([]);
  const [stagesLoading, setStagesLoading] = React.useState(false);
  /** Troca de etapa com a atividade já rodando. */
  const [switchOpen, setSwitchOpen] = React.useState(false);

  const allocations = React.useMemo(() => bootstrap?.allocations ?? [], [bootstrap]);
  const geofences = React.useMemo(() => bootstrap?.geofences ?? [], [bootstrap]);
  const running = bootstrap?.runningSession ?? null;

  const phase = deriveWorkdayPhase(todayPunches);
  const options = React.useMemo(() => nextPunchOptions(lastPunchType(todayPunches)), [todayPunches]);
  const primary = options[0];
  const secondary = React.useMemo(() => options.slice(1), [options]);
  const summary = React.useMemo(() => computeDailySummary(todayPunches), [todayPunches]);
  const latestUndoable = React.useMemo(
    () => effectivePunches(todayPunches).filter((punch) => punch.can_undo).at(-1) ?? null,
    [todayPunches],
  );

  const geofenceState = React.useMemo(
    () => (geo.state.point ? evaluateGeofenceClient(geo.state.point, geofences) : INITIAL_GEOFENCE_STATE),
    [geo.state.point, geofences],
  );

  const showPermissionCard = geo.permission !== 'granted' && geo.state.kind !== 'granted';

  const loadStages = React.useCallback(async (projectId: string) => {
    setStagesLoading(true);
    setStages([]);
    try {
      const { items } = await pontoApi.timeline(projectId);
      setStages(items);
    } catch {
      // Sem cronograma o apontamento segue sem etapa — não é bloqueio.
      setStages([]);
    } finally {
      setStagesLoading(false);
    }
  }, []);

  const openPunchFlow = React.useCallback(
    (type: PunchType) => {
      setNotice(null);
      setSelfieError(null);
      if (type === 'clock_in' && allocations.length > 0) {
        const first = allocations[0];
        setSelProject(first.project_id);
        setSelStage(null);
        void loadStages(first.project_id);
        setFlow({ stage: 'assignment', type, activity: null });
        return;
      }
      setFlow({ stage: 'selfie', type, activity: null });
    },
    [allocations, loadStages],
  );

  /* ── GPS silencioso quando a permissão já existe ── */
  const requestLocation = geo.request;
  const locationKind = geo.state.kind;
  React.useEffect(() => {
    if (geo.permission === 'granted' && locationKind === 'idle') {
      void requestLocation();
    }
  }, [geo.permission, locationKind, requestLocation]);

  /* ── etapa da atividade em andamento ──
     O bootstrap devolve só o id da etapa; carregamos o cronograma do
     projeto corrente para poder mostrar o nome e permitir a troca. */
  const runningProjectId = running?.project_id ?? null;
  React.useEffect(() => {
    if (runningProjectId) void loadStages(runningProjectId);
  }, [runningProjectId, loadStages]);

  /**
   * P3A — contexto resolvido pelo Apex. Carregado em segundo plano e sempre
   * best-effort: se falhar, a tela segue exatamente como era antes, com o
   * seletor manual de etapa como fallback.
   */
  const [resolvedContext, setResolvedContext] = React.useState<{
    status: 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'NO_EVIDENCE';
    phase: string | null;
    activity: string | null;
    activityId: string | null;
    team: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    // Só interessa quando há atividade rodando sem etapa escolhida.
    if (!running || running.timeline_item_id) {
      setResolvedContext(null);
      return;
    }
    void pontoApi
      .context()
      .then((r) => {
        if (cancelled) return;
        setResolvedContext({
          status: r.status,
          phase: r.phase,
          activity: r.activity,
          activityId: r.activityId,
          team: r.team,
        });
      })
      .catch(() => {
        if (!cancelled) setResolvedContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [running]);

  const runningStage = React.useMemo(
    () =>
      running?.timeline_item_id
        ? (stages.find((stage) => stage.id === running.timeline_item_id) ?? null)
        : null,
    [running?.timeline_item_id, stages],
  );

  function openStageSwitch() {
    if (!running) return;
    setNotice(null);
    setSelProject(running.project_id);
    setSelStage(running.timeline_item_id ?? null);
    void loadStages(running.project_id);
    setSwitchOpen(true);
  }

  /**
   * Fecha a etapa anterior e abre a nova. O próprio /api/mobile/activity
   * encerra a sessão corrente antes de iniciar — as horas já trabalhadas
   * ficam consolidadas na etapa antiga, e não migram para a nova.
   */
  async function handleStageSwitch(confirmed: boolean) {
    setSwitchOpen(false);
    if (!confirmed || !selProject) return;
    setSubmitting(true);
    try {
      await pontoApi.activity({
        action: 'start',
        projectId: selProject,
        timelineItemId: selStage ?? undefined,
      });
      await reload();
      setNotice('Etapa atualizada. As horas da etapa anterior foram fechadas e já contam no projeto.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Não foi possível trocar a etapa.');
    } finally {
      setSubmitting(false);
    }
  }

  /* ── "Bater ponto" acionado pela navegação ── */
  React.useEffect(() => {
    if (!punchFlowRequested) return;
    consumePunchFlowRequest();
    openPunchFlow(primary);
  }, [punchFlowRequested, consumePunchFlowRequest, openPunchFlow, primary]);

  function confirmAssignment(withProject: boolean) {
    setFlow((current) =>
      current
        ? {
            stage: 'selfie',
            type: current.type,
            activity: withProject && selProject ? { projectId: selProject, stageId: selStage } : null,
          }
        : null,
    );
  }

  /* ── envio: GPS fresco → selfie → marcação ── */
  async function handleSelfieConfirmed(imageDataUrl: string) {
    if (!flow) return;
    const current = flow;
    setSubmitting(true);
    setSelfieError(null);
    try {
      const fresh =
        geo.state.point && geo.state.updatedAt && Date.now() - geo.state.updatedAt < LOCATION_FRESHNESS_MS
          ? geo.state.point
          : (await geo.request()).point;

      const outcome = await submitPunch({
        type: current.type,
        selfieDataUrl: imageDataUrl,
        location: fresh,
        activity: current.activity,
      });

      switch (outcome.kind) {
        case 'registered':
          setFlow(null);
          setSuccess({
            type: outcome.type,
            occurredAt: outcome.occurredAt,
            confirmedByServer: true,
            needsReview: outcome.needsReview,
            duplicate: outcome.duplicate,
            worksite: outcome.geofence?.geofenceName ?? geofenceState.geofenceName,
            project: current.activity?.projectId ?? null,
            distanceMeters: outcome.geofence?.distanceMeters ?? null,
            insideGeofence: outcome.hasLocation ? (outcome.geofence?.inside ?? null) : null,
            hasSelfie: true,
            recordId: null,
          });
          break;

        case 'queued':
          setFlow(null);
          setSuccess({
            type: outcome.type,
            occurredAt: outcome.occurredAt,
            confirmedByServer: false,
            needsReview: false,
            duplicate: false,
            worksite: geofenceState.geofenceName,
            project: current.activity?.projectId ?? null,
            distanceMeters: geofenceState.distanceMeters,
            insideGeofence:
              geofenceState.kind === 'inside' ? true : geofenceState.kind === 'outside' ? false : null,
            hasSelfie: true,
            recordId: null,
          });
          break;

        case 'error':
          // Falha ao enviar a foto: a câmera continua aberta com a imagem
          // já capturada, para reenviar sem refazer nada (Fluxo 7).
          if (outcome.step === 'selfie') {
            setSelfieError(outcome.message);
          } else {
            setFlow(null);
            setFailure({
              title: 'Não foi possível registrar o ponto',
              description: outcome.message,
              nextStep:
                'Confira sua conexão e tente novamente. Se o problema continuar, avise seu gestor — nenhuma marcação foi criada.',
              onRetry: () => {
                setFailure(null);
                openPunchFlow(current.type);
              },
            });
          }
          break;

        case 'queue_full':
          setFlow(null);
          setFailure({
            title: 'Não foi possível guardar a marcação',
            description: outcome.message,
            nextStep: 'Conecte-se à internet e toque em “Sincronizar agora” para enviar o que já está salvo.',
          });
          break;

        case 'session_expired':
          setFlow(null);
          break;
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSyncNow() {
    const report = await syncNow();
    setSyncMessage(report.message);
  }

  async function handleUndo() {
    if (!latestUndoable) return;
    const confirmed = window.confirm(
      `Excluir a marcação de ${PUNCH_SHORT_LABEL[latestUndoable.type].toLowerCase()} das ${formatTime(latestUndoable.occurred_at)}?`,
    );
    if (!confirmed) return;
    const result = await undoLastPunch(latestUndoable.id);
    setNotice(result.message);
  }

  return (
    <div className="space-y-5">
      {loadError ? (
        <PontoCard className="flex items-start gap-3 p-4">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-ig-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-ig-body-sm text-ig-fg-strong">{loadError}</p>
            <PontoButton
              variant="secondary"
              onClick={() => void reload()}
              className="mt-2.5 min-h-[44px] text-ig-body-sm"
            >
              Tentar carregar de novo
            </PontoButton>
          </div>
        </PontoCard>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-4 py-3 text-ig-body-sm text-ig-fg"
        >
          {notice}
        </p>
      ) : null}

      {/* No desktop a ação fica numa coluna própria à esquerda e o
          acompanhamento do dia à direita — sem a coluna única espremida
          que sobrava do layout de celular. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="space-y-5">
      {showPermissionCard ? (
        <PermissionRequestCard
          icon={LocateFixed}
          title="Confirme sua localização"
          reason="Precisamos saber onde você está no momento do registro para validar que a marcação foi feita no local de trabalho."
          actionLabel={locationKind === 'blocked' ? 'Já autorizei — tentar de novo' : 'Permitir localização'}
          busy={locationKind === 'loading' || locationKind === 'requesting'}
          onRequest={() => void geo.request()}
          recovery={
            locationKind === 'blocked'
              ? 'O acesso está bloqueado para este site. Abra as configurações do navegador, autorize a localização e volte aqui.'
              : undefined
          }
        />
      ) : null}

      <AttendanceActionCard
        phase={phase}
        primary={primary}
        secondary={secondary}
        busy={busy || submitting}
        online={online}
        onAction={openPunchFlow}
      >
        <LocationStatus
          state={geo.state}
          onRequest={() => void geo.request()}
          busy={locationKind === 'loading' || locationKind === 'requesting'}
        />
        <div className="border-t border-ig-border">
          <GeofenceStatus state={geofenceState} />
        </div>
        <div className="border-t border-ig-border">
          <SyncStatus
            online={online}
            syncing={syncing}
            pending={pending}
            lastSyncMessage={syncMessage}
            onSyncNow={() => void handleSyncNow()}
          />
        </div>
        <WorksiteInfoPanel
          details={{
            worksiteName: geofenceState.geofenceName,
            projectLabel: geofenceState.projectId ?? running?.project_id ?? null,
            distanceMeters: geofenceState.distanceMeters,
            radiusMeters: geofenceState.radiusMeters,
            accuracyMeters: geo.state.point?.accuracy ?? null,
            updatedAt: geo.state.updatedAt,
          }}
        />
      </AttendanceActionCard>
      </div>

      <div className="mt-5 space-y-5 lg:mt-0">
      <section>
        <SectionLabel icon={Clock3}>Resumo de hoje</SectionLabel>
        <PontoCard className="p-4">
          <DailySummary summary={summary} />
        </PontoCard>
      </section>

      <section>
        <SectionLabel
          action={
            <Link
              href="/ponto/historico"
              className="rounded-[var(--ig-radius-sm)] text-ig-caption text-ig-accent focus-visible:outline-none focus-visible:shadow-[var(--ig-focus-ring-outer)]"
            >
              Ver histórico
            </Link>
          }
        >
          Marcações de hoje
        </SectionLabel>
        <PontoCard className="p-4">
          <AttendanceTimeline
            punches={todayPunches}
            emptyLabel="Nenhuma marcação ainda. Toque no botão acima para registrar a entrada."
          />
          {latestUndoable ? (
            <PontoButton
              variant="danger"
              icon={RotateCcw}
              disabled={busy || submitting}
              onClick={() => void handleUndo()}
              className="mt-4 min-h-[44px] text-ig-body-sm"
            >
              Excluir a última marcação
            </PontoButton>
          ) : null}
        </PontoCard>
        {latestUndoable ? (
          <p className="mt-2 px-1 text-ig-caption text-ig-fg-subtle">
            A última marcação pode ser excluída nos primeiros 5 minutos. O registro fiscal, o NSR e o
            hash permanecem preservados na auditoria.
          </p>
        ) : null}
      </section>

      {running ? (
        <section>
          <SectionLabel icon={Briefcase}>Atividade em andamento</SectionLabel>
          <PontoCard className="p-4">
            <p className="text-ig-h3 text-ig-fg-strong">
              {allocations.find((a) => a.project_id === running.project_id)?.role_title ?? 'Projeto'}
            </p>
            <p className="ig-tabular mt-0.5 text-ig-caption text-ig-fg-muted">
              {running.project_id} · iniciada às {formatTime(running.started_at)}
            </p>
            <p className="mt-2 flex items-start gap-1.5 text-ig-body-sm text-ig-fg">
              <LayoutList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ig-accent" aria-hidden="true" />
              {runningStage ? (
                <span>
                  {runningStage.wbs_code ? (
                    <span className="mr-1.5 text-ig-fg-subtle">{runningStage.wbs_code}</span>
                  ) : null}
                  {runningStage.title}
                </span>
              ) : resolvedContext?.status === 'MATCHED' && resolvedContext.activity ? (
                /*
                  P3A — o Apex resolveu a etapa a partir da evidência (ponto,
                  localização, alocação, equipe). O colaborador não precisa
                  escolher nada: só vê o que o sistema concluiu, e corrige se
                  estiver errado.
                */
                <span>
                  <span className="mr-1.5 text-ig-fg-subtle">Apex:</span>
                  {resolvedContext.activity}
                  {resolvedContext.team ? (
                    <span className="ml-1.5 text-ig-fg-subtle">· {resolvedContext.team}</span>
                  ) : null}
                </span>
              ) : (
                <span className="text-ig-fg-muted">Sem etapa do cronograma selecionada.</span>
              )}
            </p>

            {/* Contexto resolvido, mas ainda não confirmado por ninguém. */}
            {!runningStage && resolvedContext?.status === 'MATCHED' && resolvedContext.phase ? (
              <p className="mt-1 pl-5 text-ig-caption text-ig-fg-subtle">
                Fase: {resolvedContext.phase}
              </p>
            ) : null}

            {/* Ambíguo: o sistema NÃO escolhe por conta própria. */}
            {!runningStage && resolvedContext?.status === 'AMBIGUOUS' ? (
              <p className="mt-1 pl-5 text-ig-caption text-ig-fg-muted">
                Mais de uma atividade possível hoje — confirme em “Mudei de etapa”.
              </p>
            ) : null}
            <div className="mt-3.5 space-y-2">
              <PontoButton
                variant="secondary"
                icon={Replace}
                disabled={busy || submitting}
                onClick={openStageSwitch}
              >
                {!runningStage && resolvedContext?.status === 'MATCHED'
                  ? 'Não é isso que estou fazendo'
                  : 'Mudei de etapa'}
              </PontoButton>
              <PontoButton
                variant="ghost"
                icon={Square}
                disabled={busy || submitting}
                onClick={() => void stopActivity()}
              >
                Encerrar atividade
              </PontoButton>
            </div>
          </PontoCard>
        </section>
      ) : null}

      {allocations.length === 0 ? (
        <p className="rounded-[var(--ig-radius-md)] border border-ig-border bg-ig-panel px-4 py-3 text-ig-caption text-ig-fg-muted">
          Você ainda não está alocado em um projeto, então a entrada registra apenas a jornada. Peça
          ao gestor para alocar você e poder apontar as horas.
        </p>
      ) : null}
      </div>
      </div>

      {/* ── fluxos ── */}
      <WorkAssignmentSheet
        open={flow?.stage === 'assignment'}
        allocations={allocations}
        stages={stages}
        stagesLoading={stagesLoading}
        selectedProject={selProject}
        selectedStage={selStage}
        onSelectProject={(projectId) => {
          setSelProject(projectId);
          setSelStage(null);
          void loadStages(projectId);
        }}
        onSelectStage={setSelStage}
        onConfirm={confirmAssignment}
        onOpenChange={(open) => {
          if (!open) setFlow(null);
        }}
      />

      <WorkAssignmentSheet
        open={switchOpen}
        mode="switch"
        allocations={allocations}
        stages={stages}
        stagesLoading={stagesLoading}
        selectedProject={selProject}
        selectedStage={selStage}
        onSelectProject={(projectId) => {
          setSelProject(projectId);
          setSelStage(null);
          void loadStages(projectId);
        }}
        onSelectStage={setSelStage}
        onConfirm={(confirmed) => void handleStageSwitch(confirmed)}
        onOpenChange={(open) => {
          if (!open) setSwitchOpen(false);
        }}
      />

      <CameraVerification
        open={flow?.stage === 'selfie'}
        title={flow ? `Foto para ${PUNCH_SHORT_LABEL[flow.type].toLowerCase()}` : 'Foto de presença'}
        submitting={submitting}
        uploadError={selfieError}
        onConfirm={(dataUrl) => void handleSelfieConfirmed(dataUrl)}
        onCancel={() => {
          setFlow(null);
          setSelfieError(null);
        }}
      />

      <AttendanceSuccessSheet result={success} onClose={() => setSuccess(null)} />
      <AttendanceErrorSheet error={failure} onClose={() => setFailure(null)} />
    </div>
  );
}
