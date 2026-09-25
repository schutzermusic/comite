/**
 * 239 — Reparo das guardas do Motor de Aprovação.
 *
 *   node scripts/operations/apply-239.mjs --target=qa [--apply]   # QA isolado primeiro
 *   node scripts/operations/apply-239.mjs [--apply]               # banco hospedado
 *
 * Prova o FURO (sessão de outro inquilino cancela / ativa / alcança) fechado,
 * e prova que os caminhos legítimos continuam: quem pediu cancela, o servidor
 * (purchase_order_cancel, reivindicação service_role) cancela, quem administra
 * políticas ativa, o decisor elegível decide. Provas SEMPRE desfeitas.
 */
import { runMigration } from './lib/proof-kit.mjs';

await runMigration({
  version: '239',
  expectedTip: '238',
  async proofs(ctx) {
    const { one, check, rejects, succeeds, anchors } = ctx;
    const { org, actor } = anchors;
    const stamp = Date.now().toString(36).toUpperCase();
    const J = (x) => JSON.stringify(x);
    /** Mesma instrução carrega a identidade (o pooler não guarda ajuste de sessão). */
    const asUserSql = (sql) => `WITH who AS (SELECT set_config('request.jwt.claims', $1, true))
      ${sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + 1}`)}`;
    const claims = (uid) => J({ sub: uid, role: 'authenticated' });

    const tenant = async (label) => {
      const acct = (await one(`INSERT INTO public.enterprise_accounts (name, slug, status, created_by)
        VALUES ($1, $2, 'ACTIVE', $3) RETURNING id`, [`[P239] ${label}`, `p239-${label}-${stamp}`.toLowerCase(), actor])).id;
      return (await one(`INSERT INTO public.organizations (name, slug, status, enterprise_account_id, timezone)
        VALUES ($1, $2, 'active', $3, 'America/Sao_Paulo') RETURNING id`,
      [`[P239] ${label}`, `p239-org-${label}-${stamp}`.toLowerCase(), acct])).id;
    };
    const person = async (label, orgId, roleKey) => {
      const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
        VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now())
        RETURNING id`, [`p239.${label}.${stamp.toLowerCase()}@example.test`])).id;
      await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`,
        [uid, orgId, `[P239] ${label}`]);
      await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
        VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE'
        RETURNING id`, [orgId, uid]);
      await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
        ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, orgId]);
      await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, orgId, roleKey]);
      return uid;
    };

    // ── O código não carrega mais a guarda morta ──────────────────────────
    for (const fn of ['approval_request_cancel(uuid,text)', 'approval_policy_activate(uuid,boolean)',
      'approval_decide(uuid,text,text,text,uuid,text)']) {
      const src = await one(`SELECT prosrc, prosecdef FROM pg_proc WHERE oid = $1::regprocedure`, [`public.${fn}`]);
      check(`${fn.split('(')[0]}: guarda pela reivindicação JWT (apex_caller_is_browser), não por current_user`,
        src.prosrc.includes('apex_caller_is_browser()') && !/current_user IN \('authenticated','anon'\)/.test(src.prosrc) && src.prosecdef);
    }
    const grants = await one(`SELECT has_function_privilege('authenticated','public.approval_request_cancel(uuid,text)','EXECUTE') c,
      has_function_privilege('authenticated','public.approval_decide(uuid,text,text,text,uuid,text)','EXECUTE') d,
      has_function_privilege('authenticated','public.approval_policy_activate(uuid,boolean)','EXECUTE') a,
      has_function_privilege('anon','public.approval_request_cancel(uuid,text)','EXECUTE') ac`);
    check('grants preservados (authenticated executa; anon não)', grants.c && grants.d && grants.a && !grants.ac);

    // ── Cenário: política de aprovação e pedido PENDENTE no inquilino A ───
    const orgA = org;
    const requester = await person('solicitante', orgA, 'financeiro');
    const decider = await person('decisor', orgA, 'ceo_diretoria');
    const orgB = await tenant('b');
    const outsider = await person('outro', orgB, 'owner_admin');

    const pol = (await one(`INSERT INTO public.approval_policies (organization_id, policy_key, name, business_domain, created_by)
      VALUES ($1, $2, 'Prova 239', 'procurement', $3) RETURNING id`, [orgA, `p239.${stamp.toLowerCase()}`, actor])).id;
    const ver = (await one(`INSERT INTO public.approval_policy_versions (organization_id, policy_id, version_no,
        subject_type, action_type, decision_purpose)
      VALUES ($1, $2, 1, 'purchase_order', 'approve', 'APPROVAL') RETURNING id`, [orgA, pol])).id;
    const stg = (await one(`INSERT INTO public.approval_policy_stages (organization_id, policy_version_id, stage_no, name)
      VALUES ($1, $2, 1, 'Diretoria') RETURNING id`, [orgA, ver])).id;
    await one(`INSERT INTO public.approval_policy_steps (organization_id, policy_version_id, policy_stage_id, step_key, name,
        decision_purpose, eligibility_mode, role_key, sod_forbid_requester)
      VALUES ($1, $2, $3, 'diretoria', 'Diretoria', 'APPROVAL', 'ROLE', 'ceo_diretoria', true) RETURNING id`, [orgA, ver, stg]);
    // Outras versões ATIVAS de pedido de compra saem de cena só dentro da prova (o motor recusa ambiguidade).
    await one(`WITH x AS (UPDATE public.approval_policy_versions SET status = 'INACTIVE'
      WHERE organization_id = $1 AND subject_type = 'purchase_order' AND status = 'ACTIVE' RETURNING 1) SELECT count(*) n FROM x`, [orgA]);

    // Ativação: navegador de OUTRO inquilino não ativa (antes: ativava).
    await rejects('ativar política de outro inquilino é recusado (antes: aceito)',
      asUserSql('SELECT public.approval_policy_activate($1, true) FROM who'), [claims(outsider), ver], /inexistente/);
    // Navegador do mesmo inquilino SEM approvals.policy.manage também não.
    await rejects('ativar sem approvals.policy.manage é recusado', asUserSql('SELECT public.approval_policy_activate($1, true) FROM who'),
      [claims(decider), ver], /Ativação negada/);
    // Caminho de servidor (sem JWT) continua ativando — é o que as provas e rotinas usam.
    await succeeds('servidor ativa a versão validada', 'SELECT public.approval_policy_activate($1, true) r', [ver]);

    /** Um pedido de compra do inquilino A sem aprovação pendente (o motor abre UM pedido ativo por sujeito). */
    const freePo = async () => one(`SELECT p.id FROM public.purchase_orders p WHERE p.organization_id = $1
      AND NOT EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.organization_id = p.organization_id
                       AND r.subject_id = p.id AND r.status = 'PENDING') ORDER BY p.created_at LIMIT 1`, [orgA]);
    const openRequest = async (label) => {
      const po = await freePo();
      if (!po) return null;
      const created = await one(asUserSql(`SELECT public.approval_request_create($1,'purchase_order',$2,'approve','APPROVAL',
        'prova 239','{}'::jsonb,$3) r FROM who`), [claims(requester), orgA, po.id, `p239-${label}-${stamp}`]);
      return created?.r?.request_id ?? null;
    };
    const requestId = await openRequest('a');
    if (!requestId) {
      check('cenário de pedido PENDENTE montado (há pedido de compra no inquilino)', false, 'sem pedido de compra livre');
      return;
    }
    check('pedido PENDENTE aberto no inquilino A', true, requestId);

    // ── Cancelamento ──────────────────────────────────────────────────────
    await rejects('sessão de OUTRO inquilino NÃO cancela o pedido (antes: cancelava)',
      asUserSql('SELECT public.approval_request_cancel($1, $2) FROM who'), [claims(outsider), requestId, 'furo'], /inexistente/);
    const still = await one(`SELECT status FROM public.approval_requests WHERE id = $1`, [requestId]);
    check('o pedido continua PENDENTE depois da tentativa alheia', still.status === 'PENDING', still.status);
    await rejects('membro do inquilino que não pediu nem administra NÃO cancela',
      asUserSql('SELECT public.approval_request_cancel($1, $2) FROM who'), [claims(decider), requestId, 'não é meu'], /Cancelamento negado/);

    // ── Decisão: a recusa de inquilino vem ANTES da trava e do estado ─────
    const step = await one(`SELECT id FROM public.approval_request_steps WHERE request_id = $1 AND status = 'OPEN' LIMIT 1`, [requestId]);
    await rejects('decisão por sessão de outro inquilino responde "Etapa inexistente" (sem vazar estado)',
      asUserSql(`SELECT public.approval_decide($1,'APPROVED',$2) FROM who`), [claims(outsider), step.id, `p239-x-${stamp}`], /Etapa inexistente/);
    const dec = await succeeds('decisor elegível do inquilino decide normalmente',
      asUserSql(`SELECT public.approval_decide($1,'APPROVED',$2) r FROM who`), [claims(decider), step.id, `p239-d-${stamp}`]);
    check('decisão registrada pelo caminho canônico', dec?.r?.status === 'RECORDED', J(dec?.r));

    // ── Quem pediu cancela o PRÓPRIO pedido (caminho legítimo intacto) ────
    const req2 = await openRequest('b');
    if (req2) {
      const c = await succeeds('quem pediu cancela o próprio pedido', asUserSql('SELECT public.approval_request_cancel($1, $2) r FROM who'),
        [claims(requester), req2, 'desisti']);
      check('cancelamento legítimo registrado', c?.r?.status === 'CANCELLED');
    } else {
      check('segundo pedido montado para o cancelamento legítimo', false, 'sem pedido de compra livre');
    }

    // ── Caminho de servidor com reivindicação service_role (237) ──────────
    const req3 = await openRequest('c');
    if (req3) {
      const c3 = await succeeds('servidor (reivindicação service_role) cancela, como purchase_order_cancel faz',
        `WITH who AS (SELECT set_config('request.jwt.claims', $1, true)) SELECT public.approval_request_cancel($2, $3) r FROM who`,
        [J({ sub: actor, role: 'service_role' }), req3, 'cancelado pelo domínio']);
      check('cancelamento de servidor registrado', c3?.r?.status === 'CANCELLED');
    }
  },
});
