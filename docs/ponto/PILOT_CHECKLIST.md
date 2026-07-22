# Insight Ponto — Checklist do Piloto (2–3 colaboradores)

Piloto manual e controlado, com **`PONTO_AUTOMATION_ENABLED=false`** (nada
automático). Faça para cada colaborador do piloto e marque os itens.

## Pré-piloto (uma vez)
- [ ] Migrações 065–074 aplicadas (`node scripts/apply-ponto-access-migrations.mjs`).
- [ ] Envs de produção conferidas (ver `PRODUCTION_ROLLOUT.md`); automação **false**.
- [ ] Escolher 2–3 colaboradores com **e-mail válido** cadastrado em Pessoas.
- [ ] Cada um tem uma **alocação viva** no projeto do piloto.

## Por colaborador

### 1. Alocação que exige ponto
- [ ] Na alocação do colaborador, marcar **"Exige registro de ponto"**
      (`project_allocations.requires_ponto = true`).

### 2. Convite (envio manual)
- [ ] **Pessoas → "Pré-visualizar provisionamento"**: confirmar que o colaborador
      aparece como **Convidar** (elegível). O servidor **revalida** no envio.
- [ ] Selecionar o colaborador e **Enviar** (ou usar o provisionamento imediato ao
      salvar a alocação). Status vira **Convite pendente**.
- [ ] Conferir auditoria `access.ponto.invited` (sem token/senha nos logs).

### 3. Ativação
- [ ] Colaborador abre o e-mail → link `/ponto/ativar` → **cria e confirma a
      senha** → aceita termos → ativa.
- [ ] Status vira **Ativo** (o cron carimba `access_activated_at`; ou verifique no
      Supabase que o e-mail foi confirmado).

### 4. Login
- [ ] Colaborador entra em `/ponto/login` com e-mail + senha → cai em `/ponto`.

### 5. Seleção de projeto + etapa (WBS)
- [ ] Ao dar entrada, escolhe o **projeto** e a **etapa do cronograma**.

### 6. Selfie + ponto
- [ ] Captura a **selfie** (câmera) e registra o ponto.
- [ ] A selfie fica no bucket privado sob `{org}/{person}/…` e vinculada à
      marcação (`authentication_evidence`, método `facial_verification`).
- [ ] A sessão de trabalho carrega a etapa (apontamento — role
      `ponto_field_worker` = `attendance_use` + `ponto_session_use`).

### 7. Revisão do gestor
- [ ] Se a marcação caiu **em revisão** (fora do geofence), o gestor abre
      **Pessoas & Custos → Revisão de Ponto**, vê a **selfie (signed URL)** e a
      distância, e **aprova** ou **rejeita com nota**.
- [ ] Conferir persistência: `reviewed_by`, `reviewed_at`, `review_note`; status
      `accepted`/`cancelled`.

### 8. Verificação de auditoria
- [ ] `audit_logs`: `access.ponto.invited`, `activation_completed`,
      `attendance.punch.review_accepted`/`_rejected`. Sem tokens/senhas/selfies.

### 9. Monitoramento de jobs
- [ ] Painel **"Automação do Ponto"** (na Revisão de Ponto) ou `GET /api/ponto/jobs`:
      última execução OK/falha, processados, estado da automação, agendamentos.

## Rollback / bloqueio de acesso (a qualquer momento)
- [ ] **Bloquear**: Pessoas → acesso ao Ponto → **Bloquear acesso** (ban no Auth +
      flag; impede login). Status **Bloqueado**. A automação **nunca** reativa
      sozinha.
- [ ] **Revogar convite pendente**: **Revogar** (remove o auth user órfão;
      status volta a **Sem acesso**).
- [ ] **Reativar**: **Reativar acesso** (remove o ban) quando desejado.
- [ ] **Desligar tudo**: manter/definir `PONTO_AUTOMATION_ENABLED=false` — cron e
      retenção passam a **dry-run** (não enviam/apagam).

## Encerrar o piloto e liberar automação
- [ ] Todos os itens acima OK para os 2–3 pilotos.
- [ ] Revisar `ponto_job_runs` (dry-runs) sem surpresas.
- [ ] Definir `PONTO_AUTOMATION_ENABLED=true` + redeploy; revisar a **primeira
      execução real** em `GET /api/ponto/jobs` (`effectiveMode:"live"`).
