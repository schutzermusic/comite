"use client";

/**
 * DESCOBERTA — dentro da oportunidade, não num módulo à parte.
 *
 * Duas perguntas numa tela: "o que sabemos do local e do trabalho?" (os
 * levantamentos técnicos) e "já dá para propor?" (a prontidão, determinística).
 * O levantamento é aberto aqui ("Solicitar levantamento técnico") e trabalhado
 * na tela de campo, feita para celular.
 */
import { useId, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, CircleDashed, ClipboardList, ExternalLink, MapPin,
  ScanSearch, Sparkles, XCircle,
} from "lucide-react";
import { HudBadge, HudButton, HudModal, useHudToast } from "@/components/hud";
import {
  READINESS_LABEL, type ReadinessResult, type ReadinessCheckState,
} from "@/lib/commercial/proposal-readiness";
import {
  SURVEY_LIFECYCLE, SURVEY_STATUS_LABEL, digestSurvey, type SiteSurveyStatus,
} from "@/lib/commercial/site-survey";
import { day } from "./shared";
import { Section, SectionEmpty } from "./detail";
import { PersonSelect } from "./people";
import { StatePill, UnlockHint } from "./workspace";
import "./commercial-flow.css";

export interface SurveySummary {
  id: string; code: string; title: string; status: SiteSurveyStatus;
  site_name: string | null; site_address: string | null; purpose: string;
  technical_responsible_user_id: string | null; planned_visit_date: string | null;
  started_at: string | null; completed_at: string | null;
  findings: unknown; checklist: unknown; open_questions: unknown;
  apex_generated_at: string | null; created_at: string;
}

const CHECK_ICON: Record<ReadinessCheckState, JSX.Element> = {
  ok: <CheckCircle2 size={14} aria-hidden />,
  warning: <AlertTriangle size={14} aria-hidden />,
  blocking: <XCircle size={14} aria-hidden />,
};

export function ReadinessCard({ readiness }: { readiness: ReadinessResult }) {
  const tone = readiness.state === "READY_TO_PROPOSE" ? "success"
    : readiness.state === "REVIEW_REQUIRED" ? "warning" : "danger";
  const done = readiness.checks.filter((c) => c.state === "ok");
  const open = readiness.checks.filter((c) => c.state !== "ok");
  const scope = readiness.checks.find((c) => c.key === "scope");
  return (
    <div className={`flow-readiness flow-readiness-${tone} crm-readiness`} data-testid="proposal-readiness">
      <header className="crm-readiness-head">
        <div>
          <p className="crm-eyebrow">Prontidão para propor</p>
          <strong>{READINESS_LABEL[readiness.state]}</strong>
        </div>
        <div className="flex items-center gap-2">
          {scope && (
            <StatePill tone={scope.state === "ok" ? "success" : scope.state === "warning" ? "warning" : "danger"}>
              Escopo {scope.state === "ok" ? "definido" : scope.state === "warning" ? "a revisar" : "indefinido"}
            </StatePill>
          )}
          <HudBadge variant={tone} size="sm">
            {done.length}/{readiness.checks.length}
          </HudBadge>
        </div>
      </header>
      <div className="crm-readiness-bar" aria-hidden>
        {readiness.checks.map((c) => <i key={c.key} className={c.state} title={c.label} />)}
      </div>
      {open.length > 0 && (
        <>
          <p className="crm-flow-label">Falta · {open.length}</p>
          <ul className="crm-checks">
            {open.map((check) => (
              <li key={check.key} className={`crm-check crm-check-${check.state}`}>
                {CHECK_ICON[check.state]}
                <div className="min-w-0">
                  <span>{check.label}</span>
                  <small>{check.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {done.length > 0 && (
        <>
          <p className="crm-flow-label">Completo · {done.length}</p>
          <ul className="crm-checks">
            {done.map((check) => (
              <li key={check.key} className="crm-check crm-check-ok">
                {CHECK_ICON.ok}
                <div className="min-w-0">
                  <span>{check.label}</span>
                  <small>{check.detail}</small>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function SurveyProgress({ status }: { status: SiteSurveyStatus }) {
  if (status === "CANCELLED") return <HudBadge variant="subtle" size="sm">Cancelado</HudBadge>;
  const index = SURVEY_LIFECYCLE.indexOf(status);
  return (
    <ol className="flow-steps" aria-label={`Estado: ${SURVEY_STATUS_LABEL[status]}`}>
      {SURVEY_LIFECYCLE.map((step, i) => (
        <li key={step} className={i < index ? "done" : i === index ? "current" : undefined}
          title={SURVEY_STATUS_LABEL[step]} />
      ))}
    </ol>
  );
}

export function DiscoveryPanel({
  opportunityId,
  opportunityTitle,
  surveys,
  readiness,
  owners,
  canRequest,
  open,
  onChanged,
}: {
  opportunityId: string;
  opportunityTitle: string;
  surveys: SurveySummary[];
  readiness: ReadinessResult;
  owners: Record<string, string>;
  canRequest: boolean;
  open: boolean;
  onChanged: () => void;
}) {
  const [requesting, setRequesting] = useState(false);
  const digests = surveys.map((survey) => ({ survey, digest: digestSurvey(survey) }));
  const openQuestions = digests.flatMap(({ survey, digest }) =>
    digest.openQuestions.map((q) => ({ ...q, code: survey.code })));
  const active = surveys.filter((s) => !["COMPLETED", "CANCELLED"].includes(s.status));
  const requestButton = (
    <HudButton variant={surveys.length ? "secondary" : "primary"} size="sm" onClick={() => setRequesting(true)}
      disabled={!canRequest || !open}
      title={!open ? "Oportunidade encerrada." : !canRequest ? "Exige a permissão commercial.surveys.manage." : undefined}>
      <ScanSearch size={14} aria-hidden /> Solicitar levantamento técnico
    </HudButton>
  );
  return (
    <>
      {surveys.length === 0 ? (
        <UnlockHint
          tone="warning"
          icon={<ScanSearch size={14} />}
          testId="discovery-empty"
          action={requestButton}
        >
          <strong>Levantamento técnico ainda não realizado.</strong>{" "}
          {!open
            ? "A oportunidade está encerrada."
            : !canRequest
              ? "Solicitar exige a permissão commercial.surveys.manage — peça a quem gerencia levantamentos."
              : "Quando a proposta depende do que existe no local, solicite a visita antes de redigir o escopo."}
        </UnlockHint>
      ) : (
        <div className="crm-command-strip" aria-label="Situação da descoberta">
          <div className="crm-command-cell">
            <span>Levantamentos</span>
            <strong>{surveys.length}</strong>
            <small>{active.length} em andamento</small>
          </div>
          <div className="crm-command-cell">
            <span>Último estado</span>
            <strong>{SURVEY_STATUS_LABEL[surveys[0].status]}</strong>
            <small>{surveys[0].code}</small>
          </div>
          <div className="crm-command-cell">
            <span>Questões abertas</span>
            <strong className={openQuestions.length ? "crm-tone-warning" : undefined}>{openQuestions.length}</strong>
            <small>{openQuestions.length ? "respondê-las antes do escopo" : "nenhuma pendente"}</small>
          </div>
          <div className="crm-command-cell">
            <span>Prontidão</span>
            <strong className={readiness.state === "READY_TO_PROPOSE" ? "crm-tone-success" : readiness.state === "REVIEW_REQUIRED" ? "crm-tone-warning" : "crm-tone-danger"}>
              {readiness.checks.filter((c) => c.state === "ok").length}/{readiness.checks.length}
            </strong>
            <small>{READINESS_LABEL[readiness.state]}</small>
          </div>
        </div>
      )}

      {openQuestions.length > 0 && (
        <Section title="Questões técnicas em aberto" count={openQuestions.length}
          note="Levantadas em campo — cada uma pode mudar escopo, prazo ou preço.">
          <ul className="crm-linked-list">
            {openQuestions.slice(0, 8).map((q) => (
              <li key={`${q.code}-${q.id}`}>
                <CircleDashed size={14} aria-hidden />
                <div className="min-w-0">
                  <strong>{q.text}</strong>
                  <p className="crm-muted">{q.code}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <ReadinessCard readiness={readiness} />
      <Section
        title="Levantamentos técnicos"
        count={surveys.length}
        note="Visita, condições, fotos, riscos e questões em aberto — antes da proposta."
        action={surveys.length ? requestButton : undefined}
      >
        {surveys.length === 0 ? (
          <SectionEmpty>
            Nenhum levantamento registrado para esta oportunidade.
          </SectionEmpty>
        ) : (
          <ul className="flow-survey-list">
            {digests.map(({ survey, digest }) => {
              const responsible = survey.technical_responsible_user_id
                ? owners[survey.technical_responsible_user_id] ?? "Responsável não identificado"
                : "Sem responsável técnico";
              const progress = digest.checklistTotal ? digest.checklistDone / digest.checklistTotal : 0;
              const finished = survey.status === "COMPLETED" || survey.status === "CANCELLED";
              return (
                <li key={survey.id}>
                  <div className="flow-survey-head">
                    <div className="min-w-0">
                      <strong>{survey.code} · {survey.title}</strong>
                      <p className="crm-muted">
                        <MapPin size={11} aria-hidden /> {survey.site_name || survey.site_address || "Local não registrado"}
                        {" · "}{responsible}
                        {survey.planned_visit_date ? ` · visita ${day(survey.planned_visit_date)}` : " · sem data de visita"}
                      </p>
                    </div>
                    <div className="flow-survey-state">
                      <HudBadge
                        variant={survey.status === "COMPLETED" ? "success" : survey.status === "CANCELLED" ? "subtle" : "info"}
                        size="sm"
                      >
                        {SURVEY_STATUS_LABEL[survey.status]}
                      </HudBadge>
                      <SurveyProgress status={survey.status} />
                    </div>
                  </div>
                  <span className="crm-meter" aria-label={`Checklist ${Math.round(progress * 100)}%`}>
                    <i style={{ width: `${progress * 100}%` }} />
                  </span>
                  <div className="flow-survey-meta">
                    <span><ClipboardList size={12} aria-hidden /> Checklist {digest.checklistDone}/{digest.checklistTotal}</span>
                    <span>{digest.equipmentCount} equip.</span>
                    <span>{digest.riskCount} risco(s)</span>
                    <span className={digest.openQuestions.length ? "flow-warn" : undefined}>
                      {digest.openQuestions.length ? <CircleDashed size={12} aria-hidden /> : null}
                      {digest.openQuestions.length} questão(ões) em aberto
                    </span>
                    {survey.apex_generated_at && (
                      <span className="flow-apex"><Sparkles size={12} aria-hidden /> Leitura da Apex disponível</span>
                    )}
                    <Link href={`/comercial/levantamentos/${survey.id}`}
                      className={finished ? "flow-link" : "crm-field-cta"}>
                      {finished ? "Abrir" : "Trabalhar em campo"}
                      <ExternalLink size={12} aria-hidden />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {requesting && (
        <SurveyRequestModal
          opportunityId={opportunityId}
          opportunityTitle={opportunityTitle}
          onClose={() => setRequesting(false)}
          onCreated={() => onChanged()}
          onDone={() => setRequesting(false)}
        />
      )}
    </>
  );
}

const plusDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-CA");
};

export function SurveyRequestModal({
  opportunityId, opportunityTitle, onClose, onCreated, onDone,
}: {
  opportunityId: string; opportunityTitle: string; onClose: () => void;
  /** O dossiê recarrega assim que o levantamento existe. */
  onCreated: () => void;
  /** Fechar depois de criado. */
  onDone?: () => void;
}) {
  const formId = useId();
  const [purpose, setPurpose] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [responsible, setResponsible] = useState<string | null>(null);
  const [visitDate, setVisitDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string; status: string } | null>(null);
  const { success } = useHudToast();
  const close = () => (created ? (onDone ?? onClose)() : onClose());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/commercial/site-surveys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opportunityId, purpose: purpose.trim(),
          siteName: siteName.trim() || null, siteAddress: siteAddress.trim() || null,
          technicalResponsibleUserId: responsible, plannedVisitDate: visitDate || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload?.error || "Não foi possível solicitar.");
      success("Levantamento solicitado", `${payload.code} · ${payload.status === "SCHEDULED" ? "agendado" : "planejado"}`);
      setCreated({ id: payload.survey_id, code: payload.code, status: payload.status });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const scheduled = Boolean(responsible && visitDate);

  return (
    <HudModal
      isOpen
      onClose={close}
      title="Solicitar levantamento técnico"
      subtitle={opportunityTitle}
      size="lg"
      footer={created ? (
        <div className="crm-flow-footer" style={{ border: 0, paddingTop: 0, width: "100%" }}>
          <p>O responsável foi avisado com o link da tela de campo.</p>
          <div>
            <HudButton variant="ghost" onClick={close}>Voltar ao dossiê</HudButton>
            {created.id && (
              <Link href={`/comercial/levantamentos/${created.id}`} className="crm-field-cta" data-testid="survey-go-field">
                Trabalhar em campo <ExternalLink size={13} aria-hidden />
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className="crm-flow-footer" style={{ border: 0, paddingTop: 0, width: "100%" }}>
          <p>
            {purpose.trim().length < 3 ? "Falta: propósito da visita."
              : scheduled ? "Nasce AGENDADO e o responsável é avisado." : "Sem responsável e data, nasce PLANEJADO."}
          </p>
          <div>
            <HudButton variant="ghost" onClick={onClose} disabled={saving}>Cancelar</HudButton>
            <HudButton variant="primary" type="submit" form={formId} disabled={saving || purpose.trim().length < 3}>
              <ScanSearch size={15} aria-hidden /> {saving ? "Solicitando…" : "Solicitar"}
            </HudButton>
          </div>
        </div>
      )}
    >
      {created ? (
        <div className="crm-flow" data-testid="survey-created">
          <div className="crm-verdict">
            <span className="crm-verdict-icon"><CheckCircle2 size={18} aria-hidden /></span>
            <div>
              <strong>{created.code} · {created.status === "SCHEDULED" ? "agendado" : "planejado"}</strong>
              <p>O levantamento pertence a esta oportunidade e já aparece na aba Descoberta.</p>
            </div>
            <span />
          </div>
        </div>
      ) : (
        <form id={formId} className="crm-flow" onSubmit={submit} data-testid="flow-survey">
          <label className="crm-field-label crm-field-big">
            <span>Propósito da visita *</span>
            <input aria-label="Propósito da visita" required maxLength={2000} autoFocus
              value={purpose} placeholder="Ex.: avaliar disjuntores 138 kV para retrofit"
              onChange={(e) => setPurpose(e.target.value)} />
          </label>
          <div className="crm-flow-grid">
            <label className="crm-field-label">
              <span>Local</span>
              <input aria-label="Local" maxLength={300} value={siteName} placeholder="Ex.: SE Norte"
                onChange={(e) => setSiteName(e.target.value)} />
            </label>
            <label className="crm-field-label">
              <span>Endereço</span>
              <input aria-label="Endereço" maxLength={500} value={siteAddress}
                onChange={(e) => setSiteAddress(e.target.value)} />
            </label>
            <PersonSelect label="Responsável técnico" value={responsible} onChange={setResponsible} />
            <div className="crm-field">
              <label className="crm-field-label">
                <span>Data prevista da visita</span>
                <input aria-label="Data prevista da visita" type="date" value={visitDate}
                  onChange={(e) => setVisitDate(e.target.value)} />
              </label>
              <div className="crm-chips">
                {[["Amanhã", 1], ["+3 dias", 3], ["+1 semana", 7]].map(([label, n]) => (
                  <button key={label} type="button" className="crm-chip" aria-pressed={visitDate === plusDays(Number(n))}
                    onClick={() => setVisitDate(plusDays(Number(n)))}>{label}</button>
                ))}
              </div>
            </div>
          </div>
          <p className="crm-field-hint">
            O checklist inicial (acesso, dados de placa, fotos, riscos) é criado junto e é editável em campo.
          </p>
          {error && <p role="alert" className="crm-flow-error"><AlertTriangle size={14} aria-hidden /> {error}</p>}
        </form>
      )}
    </HudModal>
  );
}
