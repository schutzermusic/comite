# Insight Ponto — Checklist de Rollout em Produção

Sequência segura para ligar a automação de acesso (provisionamento + lembretes)
e a retenção de selfies. **A automação permanece DESLIGADA por padrão** — nada é
enviado/apagado automaticamente até o passo final.

## 0. Pré-requisitos
- [ ] **Migrações aplicadas** (065–073): `node scripts/apply-ponto-access-migrations.mjs`
      (idempotente; usa `SUPABASE_DB_URL`). Confere bucket `attendance-selfies`,
      colunas `people.access_*`, `project_allocations.requires_ponto`,
      `ponto_job_runs`, role `ponto_field_worker` (= `attendance_use` + `timesheet_use`).
- [ ] **Variáveis de ambiente configuradas no Vercel (Production)** — ver seção final.
      Em especial `CRON_SECRET` e `PONTO_AUTOMATION_ENABLED=false`.
- [ ] `NEXT_PUBLIC_PONTO_URL` aponta para o portal (`https://ponto.insightapex.co`).
- [ ] `PONTO_INVITE_TTL_HOURS` casa com o TTL real do link no Supabase
      (Authentication → Email → link expiry).

## 1. Automação desligada (estado inicial)
- [ ] `PONTO_AUTOMATION_ENABLED` ausente ou `false`.
- [ ] Verifique: `curl -s -XPOST "$BASE/api/ponto/cron" -H "authorization: Bearer $CRON_SECRET"`
      retorna `automationEnabled:false` e `effectiveMode:"dry_run"` (nada é enviado).

## 2. Dry-run revisado
- [ ] Rode `node scripts/ponto-cron.mjs --dry-run` (ou a tela **Pessoas →
      "Pré-visualizar provisionamento"**).
- [ ] Confira os totais `wouldInvite / wouldRemind / wouldSkip / wouldFail` e os
      motivos por pessoa. Nada deve surpreender.

## 3. Marcar quem exige ponto
- [ ] Nas alocações dos pilotos, marque **"Exige registro de ponto"**
      (`project_allocations.requires_ponto`). Só esses entram no provisionamento.

## 4. Piloto (envio manual e confirmado)
- [ ] Em **Pessoas → Pré-visualizar provisionamento**, selecione poucos pilotos
      e confirme. O servidor **revalida cada pessoa** antes de enviar
      (ativa, alocação viva que exige ponto, e-mail válido, não bloqueada, sem
      conflito de e-mail). Registros alterados após o preview são pulados.
- [ ] Alternativa: alocar/ativar um piloto com "Exige registro de ponto" dispara
      o provisionamento imediato (best-effort; não bloqueia a alocação).

## 5. Ativação confirmada
- [ ] O piloto abre o e-mail → link `/ponto/ativar` → cria senha → aceita termos.
- [ ] Status na tela de Pessoas passa a **Ativo** (o cron carimba `activated_at`).

## 6. Ponto confirmado
- [ ] Piloto entra em `/ponto/login`, escolhe projeto + etapa (WBS), tira a
      **selfie** e registra o ponto.
- [ ] A selfie fica no bucket privado sob `{org}/{person}/…` e vinculada à
      marcação como `authentication_evidence` (`facial_verification`).

## 7. Revisão do gestor confirmada
- [ ] Em **Pessoas & Custos → Revisão de Ponto**, o gestor vê marcações
      `under_review` (fora do geofence), aprova/rejeita (rejeição exige nota).
- [ ] O painel **"Automação do Ponto"** mostra estado + últimas execuções.

## 8. Retenção testada (dry-run)
- [ ] `node scripts/purge-attendance-selfies.mjs --dry-run` → `filesDeleted:0`,
      `scanned/matched` coerentes. **Nada é apagado** com automação desligada.

## 9. Monitoramento
- [ ] `GET /api/ponto/jobs` (ou o painel de Revisão) mostra última execução OK /
      falha, processados, falhas, estado da automação e próximos agendamentos.
- [ ] Chip **"Falha no provisionamento"** em Pessoas sinaliza e-mail ausente etc.
- [ ] Auditoria (`audit_logs` + `ponto_job_runs`) sem tokens/senhas/selfies.

## 10. Ligar a automação
- [ ] Só após os passos 4–9 OK: defina `PONTO_AUTOMATION_ENABLED=true` no Vercel
      (Production) e redeploy.
- [ ] O cron horário (`/api/ponto/cron`) passa a provisionar/lembrar de verdade;
      a retenção diária (`/api/ponto/retention`, 03h) passa a apagar de verdade.

## 11. Primeira execução agendada revisada
- [ ] Após o primeiro disparo real, revise `GET /api/ponto/jobs`: `effectiveMode:"live"`,
      contagens esperadas, `failed` baixo, sem `error_summary` inesperado.
- [ ] Rollout completo: marque `requires_ponto` nas demais alocações conforme
      a operação avança.

---

## Variáveis de ambiente (Vercel Production)
| Variável | Papel | Default |
|---|---|---|
| `CRON_SECRET` | Bearer dos jobs (`/api/ponto/cron`, `/api/ponto/retention`). O Vercel Cron envia automaticamente. **Nunca** commitado/logado. | — (obrigatório) |
| `PONTO_AUTOMATION_ENABLED` | Kill switch. `false` = jobs só em dry-run. | `false` |
| `PONTO_INVITE_TTL_HOURS` | Validade do link de ativação (casar com o Supabase). | `24` |
| `PONTO_SELFIE_RETENTION_DAYS` | Retenção LGPD das selfies. | `90` |
| `PONTO_RETENTION_BATCH_SIZE` | Arquivos por passe da retenção. | `500` |
| `PONTO_RETENTION_MAX_MS` | Duração máx por passe (ms). | `240000` |
| `NEXT_PUBLIC_PONTO_URL` | Base dos links de ativação. | origin |
| `SUPABASE_SERVICE_ROLE_KEY` | Uploads/inserts server-side. | — (obrigatório) |
| `RESEND_API_KEY` / `APP_EMAIL_FROM` | Envio de e-mail. | — (obrigatório p/ convites) |

> **Segurança:** os segredos ficam só no ambiente (o `.env.local` é git-ignored).
> Os endpoints de cron aceitam o segredo **apenas** via `Authorization: Bearer`,
> com comparação de tempo constante; query param não é aceito.
