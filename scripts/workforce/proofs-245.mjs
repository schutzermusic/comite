/**
 * PROVAS DA 245 — destinatários do alerta de ASO. Sempre desfeitas.
 *
 * Recebe o resumo (nomes + situação de exame ocupacional) só quem tem vínculo
 * ATIVO, e-mail confirmado e `people.view_sensitive_data` na organização.
 */
export async function asoRecipientProofs(ctx) {
  const { one, all, check, anchors, browserCannotExecute } = ctx;
  const { org } = anchors;
  const stamp = Date.now().toString(36).toLowerCase();

  await browserCannotExecute(['aso_alert_member_directory(uuid)']);

  const other = (await one(`INSERT INTO public.organizations (name, slug, enterprise_account_id)
    SELECT '[P245] outra', $2, enterprise_account_id FROM public.organizations WHERE id = $1 RETURNING id`, [org, `p245-${stamp}`])).id;
  const person = async (label, roleKey, { o = org, confirmed = true, status = 'ACTIVE' } = {}) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now(), CASE WHEN $2 THEN now() END)
      RETURNING id`, [`p245.${label}.${stamp}@example.test`, confirmed])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`, [uid, o, `[P245] ${label}`]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at, disabled_at)
      VALUES ($1,$2,$3::text,'INVITE',now(), CASE WHEN $3::text IN ('SUSPENDED','REVOKED') THEN now() END)
      ON CONFLICT (organization_id, user_id) DO UPDATE SET status = EXCLUDED.status, disabled_at = EXCLUDED.disabled_at RETURNING id`, [o, uid, status]);
    if (roleKey) {
      await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
        SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, o, roleKey]);
    }
    return uid;
  };

  const admin = await person('admin', 'owner_admin');
  const rh = await person('rh', 'rh'); // people.view, sem dado sensível
  const semConfirmar = await person('nao-confirmado', 'owner_admin', { confirmed: false });
  const saiu = await person('saiu', 'owner_admin', { status: 'REVOKED' });
  const fora = await person('fora', 'owner_admin', { o: other });

  const dir = (await all(`SELECT user_id FROM public.aso_alert_member_directory($1)`, [org])).map((x) => x.user_id);
  check('recebe quem vê dado sensível de pessoas (owner_admin)', dir.includes(admin));
  check('NÃO recebe quem só vê a fila sem nomes (rh: people.view)', !dir.includes(rh));
  check('NÃO recebe e-mail não confirmado', !dir.includes(semConfirmar));
  check('NÃO recebe vínculo revogado', !dir.includes(saiu));
  check('NÃO recebe titular de outra organização', !dir.includes(fora));
}
