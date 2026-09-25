/**
 * PROVAS DA 244 — endurecimento do e-mail da folha. Sempre desfeitas.
 *
 *   • permissão checada NA organização pedida (payroll_actor_can), só servidor;
 *   • membro-destinatário: vínculo ativo + permissão de ler a folha + e-mail
 *     confirmado (o convite do Ponto não vira destinatário);
 *   • armazenamento da folha e livro de e-mail: navegador não escreve.
 */
export async function payrollHardeningProofs(ctx) {
  const { one, all, check, rejects, anchors, browserCannotExecute } = ctx;
  const { org } = anchors;
  const stamp = Date.now().toString(36).toLowerCase();
  const J = (x) => JSON.stringify(x);

  await browserCannotExecute(['payroll_actor_can(uuid,uuid,text)', 'payroll_email_member_directory(uuid)']);

  const other = (await one(`INSERT INTO public.organizations (name, slug, enterprise_account_id)
    SELECT '[P244] outra', $2, enterprise_account_id FROM public.organizations WHERE id = $1 RETURNING id`, [org, `p244-${stamp}`])).id;
  const person = async (label, roleKey, { o = org, confirmed = true } = {}) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now(), CASE WHEN $2 THEN now() END)
      RETURNING id`, [`p244.${label}.${stamp}@example.test`, confirmed])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`, [uid, o, `[P244] ${label}`]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
      VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE' RETURNING id`, [o, uid]);
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, o]);
    if (roleKey) {
      await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, o, roleKey]);
    }
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
  const can = async (uid, key, o = org) => (await one(`SELECT public.payroll_actor_can($1,$2,$3) ok`, [o, uid, key])).ok;

  const rh = await person('rh', 'rh');
  const fin = await person('financeiro', 'financeiro');
  const compras = await person('compras', 'compras');
  const pontista = await person('ponto', 'ponto_field_worker');
  const naoConfirmado = await person('nao-confirmado', 'financeiro', { confirmed: false });
  const admin = await person('admin', 'owner_admin');
  const fora = await person('fora', 'owner_admin', { o: other });

  // 1. Permissão na organização pedida.
  check('rh tem payroll_close na organização', await can(rh, 'people.payroll_close'));
  check('compras não tem payroll_close', !(await can(compras, 'people.payroll_close')));
  check('owner_admin passa (admin)', await can(admin, 'people.payroll_admin'));
  check('titular de OUTRA organização não tem permissão NESTA', !(await can(fora, 'people.payroll_close')));
  check('e tem na dela', await can(fora, 'people.payroll_close', other));
  await one(`UPDATE public.organization_memberships SET status = 'REVOKED', disabled_at = now() WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, fin]);
  check('vínculo revogado perde a permissão (o papel continua gravado)', !(await can(fin, 'people.payroll_view_sensitive')));

  // 2. Diretório de destinatários.
  const dir = (await all(`SELECT user_id FROM public.payroll_email_member_directory($1)`, [org])).map((x) => x.user_id);
  check('diretório inclui quem lê a folha (rh)', dir.includes(rh));
  check('diretório exclui vínculo ativo SEM permissão de folha (compras)', !dir.includes(compras));
  check('diretório exclui o usuário criado pelo convite do Ponto (ponto_field_worker)', !dir.includes(pontista));
  check('diretório exclui e-mail não confirmado', !dir.includes(naoConfirmado));
  check('diretório exclui vínculo revogado', !dir.includes(fin));
  check('diretório exclui outra organização', !dir.includes(fora));

  // 3. Armazenamento da folha: sem política de escrita do navegador.
  const writes = await all(`SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
    AND cmd IN ('INSERT','UPDATE','DELETE','ALL') AND (coalesce(qual,'') || coalesce(with_check,'')) ILIKE '%payroll%'`);
  check('nenhuma política de escrita do navegador nos buckets da folha', writes.length === 0, writes.map((w) => w.policyname).join(', '));
  await as(rh, async () => {
    await rejects('navegador NÃO grava objeto no bucket de relatórios da folha (antes: trocava os bytes do anexo)',
      `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('payroll-reports', $1, auth.uid())`,
      [`${org}/p244/generated/executive_pdf-x.html`], /row-level security|permission denied/);
  });

  // 4. Livro do transporte: navegador não forja "enviado".
  await as(admin, async () => {
    await rejects('navegador NÃO insere em email_dispatches (antes: forjava "enviado" e suprimia a entrega)',
      `INSERT INTO public.email_dispatches (organization_id, target_email, subject, status, provider) VALUES ($1,'x@example.test','s','sent','resend')`,
      [org], /permission denied/);
  });

  // 5. Resumo da intenção.
  const col = await one(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name = 'payroll_email_packages' AND column_name = 'intent_digest'`);
  check('pacote guarda o resumo da intenção', col.n === 1);
}
