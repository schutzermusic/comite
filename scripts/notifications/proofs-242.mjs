/**
 * PROVAS DA 242 — notificações no inquilino ativo, sem escrita do destinatário.
 * Sempre desfeitas (a transação do ensaio volta ao SAVEPOINT).
 *
 *   • a pessoa em DUAS organizações lê só os avisos da organização ativa;
 *   • o destinatário não reescreve, não move, não apaga, não insere;
 *   • ler/arquivar é governado: só a própria linha, só no inquilino ativo, e
 *     arquivar não apaga (o histórico de entrega fica);
 *   • as portas de criação exigem vínculo ATIVO e link relativo do app;
 *   • links legados absolutos viram o caminho; o resto, nulo.
 */
export const LEGACY_MARK = '[P242] legado';

/** Roda ANTES da migration, na mesma transação: linhas com links no formato antigo. */
export async function legacyPreflight(db) {
  const r = (await db.query(`SELECT organization_id, recipient_user_id FROM public.notifications LIMIT 1`)).rows[0]
    ?? (await db.query(`SELECT om.organization_id, om.user_id recipient_user_id FROM public.organization_memberships om
          WHERE om.status = 'ACTIVE' LIMIT 1`)).rows[0];
  if (!r) return;
  for (const [n, link] of [['abs', 'https://app.example.test/reunioes?task=1'], ['js', 'javascript:alert(1)'],
    ['ok', '/decisoes'], ['proto', '//evil.example/x']]) {
    await db.query(`INSERT INTO public.notifications (organization_id, recipient_user_id, type, title, link_url)
      VALUES ($1,$2,'legacy',$3,$4)`, [r.organization_id, r.recipient_user_id, `${LEGACY_MARK} ${n}`, link]);
  }
}

/** Remove as linhas do preflight antes do COMMIT (elas ficam fora do SAVEPOINT das provas). */
export async function legacyCleanup(db) {
  await db.query(`DELETE FROM public.notifications WHERE title LIKE $1`, [`${LEGACY_MARK}%`]);
}

export async function notificationProofs(ctx) {
  const { one, all, check, rejects, succeeds, anchors, tablesAreGoverned, browserCannotExecute } = ctx;
  const { org } = anchors;
  const stamp = Date.now().toString(36).toLowerCase();
  const J = (x) => JSON.stringify(x);

  // Links legados (inseridos pelo preflight, antes da migration).
  const legacy = await all(`SELECT title, link_url FROM public.notifications WHERE title LIKE $1 ORDER BY title`, [`${LEGACY_MARK}%`]);
  if (legacy.length) {
    const by = Object.fromEntries(legacy.map((l) => [l.title.split(' ').pop(), l.link_url]));
    check('link legado absoluto vira o caminho do app', by.abs === '/reunioes?task=1', J(by));
    check('link legado javascript: vira nulo', by.js === null);
    check('link legado protocolo-relativo (//host) vira nulo', by.proto === null);
    check('link relativo legítimo fica como estava', by.ok === '/decisoes');
  }

  await tablesAreGoverned(['notifications']);
  await browserCannotExecute(['create_notification_for(uuid,uuid,text,text,text,text)',
    'notification_recipient_is_active_member(uuid,uuid)']);
  for (const fn of ['notification_mark_read(uuid)', 'notification_mark_all_read()', 'notification_dismiss(uuid)', 'create_notification(uuid,text,text,text,text)']) {
    const r = await one(`SELECT has_function_privilege('authenticated', $1, 'EXECUTE') a, has_function_privilege('anon', $1, 'EXECUTE') b`, [`public.${fn}`]);
    check(`${fn.split('(')[0]}: porta do navegador (authenticated sim, anon não)`, r.a && !r.b);
  }

  const other = (await one(`INSERT INTO public.organizations (name, slug, enterprise_account_id)
    SELECT '[P242] outra organização', $2, enterprise_account_id FROM public.organizations WHERE id = $1 RETURNING id`,
    [org, `p242-${stamp}`])).id;
  const person = async (label, { orgs = [org], active = org, status = 'ACTIVE' } = {}) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now())
      RETURNING id`, [`p242.${label}.${stamp}@example.test`])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      [uid, orgs[0], `[P242] ${label}`]);
    for (const o of orgs) {
      await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at, disabled_at)
        VALUES ($1,$2,$3::text,'INVITE',now(), CASE WHEN $3::text IN ('SUSPENDED','REVOKED') THEN now() END)
        ON CONFLICT (organization_id, user_id) DO UPDATE SET status = EXCLUDED.status, disabled_at = EXCLUDED.disabled_at
        RETURNING id`, [o, uid, status]);
    }
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, active]);
    return uid;
  };
  const as = async (uid, fn) => {
    await all(`SELECT set_config('request.jwt.claims', $1, true)`, [J({ sub: uid, role: 'authenticated' })]);
    await all('SET LOCAL ROLE authenticated');
    try { return await fn(); } finally {
      await all('RESET ROLE');
      await all(`SELECT set_config('request.jwt.claims', '', true)`);
    }
  };
  const notify = async (o, uid, title, link = '/decisoes') => (await one(`INSERT INTO public.notifications
    (organization_id, recipient_user_id, type, title, link_url) VALUES ($1,$2,'p242',$3,$4) RETURNING id`, [o, uid, title, link])).id;

  const ana = await person('ana', { orgs: [org, other] });   // duas organizações, ativa = org
  const bia = await person('bia');
  const saiu = await person('saiu', { status: 'REVOKED' });
  const fora = await person('fora', { orgs: [other], active: other });
  const mine = await notify(org, ana, 'P242 da ativa');
  const elsewhere = await notify(other, ana, 'P242 da outra');
  const bias = await notify(org, bia, 'P242 da bia');

  // 1. Leitura: só o inquilino ativo.
  const seen = await as(ana, () => all(`SELECT id FROM public.notifications WHERE title LIKE 'P242 %'`));
  check('duas organizações: lê o aviso da organização ATIVA', seen.some((r) => r.id === mine));
  check('duas organizações: NÃO lê o aviso da outra organização (antes: lia)', !seen.some((r) => r.id === elsewhere));
  check('não lê aviso de outra pessoa', !seen.some((r) => r.id === bias));

  // 2. Nenhuma escrita direta do destinatário.
  await as(ana, async () => {
    await rejects('destinatário NÃO reescreve título/link (antes: reescrevia)',
      `UPDATE public.notifications SET title = 'FORJADO', link_url = 'https://evil.example' WHERE id = $1`, [mine], /permission denied/);
    await rejects('destinatário NÃO move a linha para outra organização (antes: movia)',
      `UPDATE public.notifications SET organization_id = $2 WHERE id = $1`, [mine, other], /permission denied/);
    await rejects('destinatário NÃO apaga (antes: apagava o histórico)',
      `DELETE FROM public.notifications WHERE id = $1`, [mine], /permission denied/);
    await rejects('destinatário NÃO insere aviso direto',
      `INSERT INTO public.notifications (organization_id, recipient_user_id, type, title) VALUES ($1,$2,'x','x')`, [org, ana], /permission denied/);
  });
  const intact = await one(`SELECT title, organization_id FROM public.notifications WHERE id = $1`, [mine]);
  check('a linha continua íntegra', intact.title === 'P242 da ativa' && intact.organization_id === org);

  // 3. Ler / arquivar governados.
  const r1 = await as(ana, () => one(`SELECT public.notification_mark_read($1) ok`, [mine]));
  const r2 = await as(ana, () => one(`SELECT public.notification_mark_read($1) ok`, [mine]));
  check('marcar como lida: a própria, uma vez (repetir não muda nada)', r1.ok === true && r2.ok === false);
  const r3 = await as(ana, () => one(`SELECT public.notification_mark_read($1) ok`, [elsewhere]));
  check('marcar lida a da OUTRA organização: recusado em silêncio', r3.ok === false
    && (await one(`SELECT read_at FROM public.notifications WHERE id = $1`, [elsewhere])).read_at === null);
  const r4 = await as(ana, () => one(`SELECT public.notification_mark_read($1) ok`, [bias]));
  check('marcar lida a de OUTRA pessoa: recusado em silêncio', r4.ok === false
    && (await one(`SELECT read_at FROM public.notifications WHERE id = $1`, [bias])).read_at === null);
  await notify(org, ana, 'P242 segunda');
  const all1 = await as(ana, () => one(`SELECT public.notification_mark_all_read() n`));
  check('marcar todas: só as da organização ativa', all1.n >= 1
    && (await one(`SELECT read_at FROM public.notifications WHERE id = $1`, [elsewhere])).read_at === null, `n=${all1.n}`);
  const d1 = await as(ana, () => one(`SELECT public.notification_dismiss($1) ok`, [mine]));
  const kept = await one(`SELECT dismissed_at IS NOT NULL dismissed, title FROM public.notifications WHERE id = $1`, [mine]);
  check('arquivar: marca dismissed_at e a linha FICA (histórico de entrega)', d1.ok === true && kept.dismissed && kept.title === 'P242 da ativa');
  await rejects('sem sessão (servidor sem auth.uid) não usa a porta do navegador',
    `SELECT public.notification_mark_read($1)`, [mine], /PERMISSION_DENIED/);

  // 4. Portas de criação.
  await as(ana, async () => {
    await succeeds('create_notification: membro ativo + caminho do app',
      `SELECT public.create_notification($1, 'task_assigned', 'P242 ok', 'corpo', '/reunioes?task=1')`, [bia]);
    await rejects('create_notification: link externo recusado',
      `SELECT public.create_notification($1, 'task_assigned', 'P242', NULL, 'https://evil.example/login')`, [bia], /LINK_NOT_APP_PATH/);
    await rejects('create_notification: link protocolo-relativo (//host) recusado',
      `SELECT public.create_notification($1, 'task_assigned', 'P242', NULL, '//evil.example')`, [bia], /LINK_NOT_APP_PATH/);
    await rejects('create_notification: javascript: recusado',
      `SELECT public.create_notification($1, 'task_assigned', 'P242', NULL, 'javascript:alert(1)')`, [bia], /LINK_NOT_APP_PATH/);
    await rejects('create_notification: vínculo REVOGADO recusado (antes: aceito pelo perfil)',
      `SELECT public.create_notification($1, 'task_assigned', 'P242', NULL, NULL)`, [saiu], /fora da organização/);
    await rejects('create_notification: membro só de OUTRA organização recusado',
      `SELECT public.create_notification($1, 'task_assigned', 'P242', NULL, NULL)`, [fora], /fora da organização/);
  });
  await rejects('create_notification_for: link externo recusado',
    `SELECT public.create_notification_for($1, $2, 'x', 'P242', NULL, 'https://evil.example')`, [org, bia], /LINK_NOT_APP_PATH/);
  await rejects('create_notification_for: vínculo revogado recusado',
    `SELECT public.create_notification_for($1, $2, 'x', 'P242', NULL, NULL)`, [org, saiu], /RECIPIENT_OUTSIDE_ORGANIZATION/);
  await succeeds('create_notification_for: membro ativo, caminho do app',
    `SELECT public.create_notification_for($1, $2, 'x', 'P242 servidor', NULL, '/decisoes')`, [org, bia]);
  await rejects('CHECK estrutural: nem o servidor grava link externo direto',
    `INSERT INTO public.notifications (organization_id, recipient_user_id, type, title, link_url) VALUES ($1,$2,'x','x','https://evil.example')`,
    [org, bia], /notifications_link_is_app_path/);
}
