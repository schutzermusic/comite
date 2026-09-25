/**
 * PROVAS DA 243 — destinatários governados do e-mail da folha. Sempre desfeitas.
 *
 *   • o navegador lê contatos (quem envia escolhe) e não escreve;
 *   • só quem pode enviar/administrar a folha lê, e só na organização ativa;
 *   • o endereço é uma caixa simples (sem quebra de linha, aspas, vírgula);
 *   • um endereço ativo por organização; o contato não muda — revoga-se;
 *   • a intenção de envio (`request_id`) é única por organização.
 */
export async function payrollEmailProofs(ctx) {
  const { one, all, check, rejects, succeeds, anchors, tablesAreGoverned } = ctx;
  const { org } = anchors;
  const stamp = Date.now().toString(36).toLowerCase();
  const J = (x) => JSON.stringify(x);

  await tablesAreGoverned(['payroll_email_contacts']);

  const other = (await one(`INSERT INTO public.organizations (name, slug, enterprise_account_id)
    SELECT '[P243] outra organização', $2, enterprise_account_id FROM public.organizations WHERE id = $1 RETURNING id`,
  [org, `p243-${stamp}`])).id;
  const person = async (label, roleKey, o = org) => {
    const uid = (await one(`INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, email_confirmed_at)
      VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1,'x',now(),now(),now())
      RETURNING id`, [`p243.${label}.${stamp}@example.test`])).id;
    await one(`INSERT INTO public.profiles (user_id, organization_id, full_name, status) VALUES ($1,$2,$3,'active') RETURNING id`, [uid, o, `[P243] ${label}`]);
    await one(`INSERT INTO public.organization_memberships (organization_id, user_id, status, source, joined_at)
      VALUES ($1,$2,'ACTIVE','INVITE',now()) ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'ACTIVE' RETURNING id`, [o, uid]);
    await one(`INSERT INTO public.user_active_organization (user_id, organization_id) VALUES ($1,$2)
      ON CONFLICT (user_id) DO UPDATE SET organization_id = EXCLUDED.organization_id RETURNING user_id`, [uid, o]);
    await one(`INSERT INTO public.user_roles (user_id, role_id, organization_id)
      SELECT $1, r.id, $2 FROM public.roles r WHERE r.key = $3 AND r.organization_id IS NULL RETURNING role_id`, [uid, o, roleKey]);
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

  const admin = await person('admin', 'owner_admin');
  const rh = await person('rh', 'rh');
  const compras = await person('compras', 'compras');
  const fora = await person('fora', 'owner_admin', other);

  // 1. Formato.
  const email = `contabilidade.${stamp}@example.test`;
  const c1 = await succeeds('contato válido (servidor) é gravado',
    `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name, created_by) VALUES ($1,$2,'Contabilidade',$3) RETURNING id`,
    [org, email, admin]);
  for (const bad of ['a@b.c\r\nBcc: x@evil.example', '"x"@evil.example', 'a,b@evil.example', 'a;b@evil.example', 'sem-arroba.example', `${'a'.repeat(250)}@x.io`]) {
    await rejects(`endereço fora do formato é recusado (${JSON.stringify(bad).slice(0, 28)})`,
      `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,$2,'X')`, [org, bad], /payroll_email_contacts_mailbox/);
  }
  await rejects('nome vazio é recusado',
    `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,$2,'  ')`, [org, `n.${stamp}@example.test`], /payroll_email_contacts_name/);

  // 2. Unicidade do ativo, sem diferença de caixa.
  await rejects('o mesmo endereço ativo duas vezes (outra caixa) é recusado',
    `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,$2,'Dup')`, [org, email.toUpperCase()], /payroll_email_contacts_active_email/);
  await succeeds('o mesmo endereço em OUTRA organização é outro contato',
    `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,$2,'Outra') RETURNING id`, [other, email]);

  // 3. Imutável; só revogação, uma vez.
  if (c1) {
    await rejects('o endereço de um contato não muda', `UPDATE public.payroll_email_contacts SET email = 'x@evil.example' WHERE id = $1`, [c1.id], /PAYROLL_CONTACT_IMMUTABLE/);
    await rejects('a organização de um contato não muda', `UPDATE public.payroll_email_contacts SET organization_id = $2 WHERE id = $1`, [c1.id, other], /PAYROLL_CONTACT_IMMUTABLE/);
    await rejects('revogação exige autoria', `UPDATE public.payroll_email_contacts SET revoked_at = now() WHERE id = $1`, [c1.id], /payroll_email_contacts_revocation/);

    // 4. RLS de leitura.
    const seenRh = await as(rh, () => all(`SELECT id FROM public.payroll_email_contacts WHERE id = $1`, [c1.id]));
    check('quem envia a folha (rh) lê os contatos da organização', seenRh.length === 1);
    const seenCompras = await as(compras, () => all(`SELECT id FROM public.payroll_email_contacts WHERE id = $1`, [c1.id]));
    check('papel sem permissão de folha (compras) não lê', seenCompras.length === 0);
    const seenFora = await as(fora, () => all(`SELECT id FROM public.payroll_email_contacts WHERE id = $1`, [c1.id]));
    check('titular de OUTRA organização não lê', seenFora.length === 0);

    // 5. Navegador não escreve.
    await as(admin, async () => {
      await rejects('navegador não cadastra contato (nem o admin)', `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,'y@example.test','Y')`, [org], /permission denied/);
      await rejects('navegador não troca endereço', `UPDATE public.payroll_email_contacts SET display_name = 'Z' WHERE id = $1`, [c1.id], /permission denied/);
      await rejects('navegador não apaga', `DELETE FROM public.payroll_email_contacts WHERE id = $1`, [c1.id], /permission denied/);
    });

    await succeeds('revogar (servidor, com autoria) funciona',
      `UPDATE public.payroll_email_contacts SET revoked_at = now(), revoked_by = $2, revoke_reason = 'prova' WHERE id = $1 RETURNING id`, [c1.id, admin]);
    await rejects('revogado não volta nem muda', `UPDATE public.payroll_email_contacts SET revoke_reason = 'outra' WHERE id = $1`, [c1.id], /PAYROLL_CONTACT_REVOKED/);
    await succeeds('depois de revogado, o endereço pode ser autorizado de novo',
      `INSERT INTO public.payroll_email_contacts (organization_id, email, display_name) VALUES ($1,$2,'De novo') RETURNING id`, [org, email]);
  }

  // 6. Tabelas da folha: escrita só do servidor (a linha de anexo forjada
  //    apontava o download do service role para qualquer objeto).
  const writable = await all(`SELECT c.relname FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'payroll\\_%'
      AND (has_table_privilege('authenticated', c.oid, 'INSERT') OR has_table_privilege('authenticated', c.oid, 'UPDATE')
        OR has_table_privilege('authenticated', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'INSERT'))`);
  check('nenhuma tabela payroll_* aceita escrita do navegador', writable.length === 0, writable.map((r) => r.relname).join(', '));
  const anyBatch = await one(`SELECT id FROM public.payroll_closing_batches WHERE organization_id = $1 LIMIT 1`, [org]);
  await as(admin, async () => {
    await rejects('navegador NÃO forja linha de anexo (antes: apontava o download do servidor)',
      `INSERT INTO public.payroll_attachments (organization_id, batch_id, file_name, file_type, security_level, storage_bucket, object_path)
       VALUES ($1, $2, 'x.pdf', 'supporting_document', 'aggregate', 'payroll-holerites', '/qualquer/objeto')`,
      [org, anyBatch?.id ?? '00000000-0000-0000-0000-000000000000'], /permission denied/);
    await rejects('navegador NÃO reescreve a narrativa do e-mail no fechamento',
      `UPDATE public.payroll_closing_batches SET metadata = '{"email_narrative":{"closing_email":"x"}}' WHERE organization_id = $1`, [org], /permission denied/);
    await rejects('navegador NÃO reescreve rótulo de centro de custo',
      `UPDATE public.payroll_cost_center_summaries SET cost_center_label = 'x' WHERE organization_id = $1`, [org], /permission denied/);
  });
  const total = (await one(`SELECT count(*)::int n FROM public.payroll_closing_batches WHERE organization_id = $1`, [org])).n;
  const readable = (await as(rh, () => all(`SELECT count(*)::int n FROM public.payroll_closing_batches WHERE organization_id = $1`, [org])))[0].n;
  check('a LEITURA pela RLS continua (rh lê todos os fechamentos da organização)', readable === total, `${readable}/${total}`);

  // 7. Diretório de membros: vínculo ATIVO, organização pedida.
  const r = await one(`SELECT has_function_privilege('authenticated', 'public.payroll_email_member_directory(uuid)', 'EXECUTE') a`);
  check('navegador não executa payroll_email_member_directory', !r.a);
  const saiu = await person('saiu', 'rh');
  await one(`UPDATE public.organization_memberships SET status = 'REVOKED', disabled_at = now() WHERE organization_id = $1 AND user_id = $2 RETURNING id`, [org, saiu]);
  const dir = (await all(`SELECT user_id FROM public.payroll_email_member_directory($1)`, [org])).map((x) => x.user_id);
  check('diretório inclui membro ativo', dir.includes(rh));
  check('diretório EXCLUI vínculo revogado (o perfil segue "active")', !dir.includes(saiu));
  check('diretório não traz membro de outra organização', !dir.includes(fora));

  // 8. Intenção de envio única por organização.
  const batch = await one(`SELECT id FROM public.payroll_closing_batches WHERE organization_id = $1 LIMIT 1`, [org])
    ?? await one(`INSERT INTO public.payroll_closing_batches (organization_id, competence_month, status) VALUES ($1,$2,'imported') RETURNING id`,
      [org, `9${stamp.slice(-3)}-0${1 + (stamp.length % 9)}`]);
  const rid = (await one(`SELECT gen_random_uuid() id`)).id;
  await succeeds('pacote com request_id', `INSERT INTO public.payroll_email_packages (organization_id, batch_id, audience, subject, html_body, attachment_ids, status, request_id)
    VALUES ($1,$2,'custom','s','h','{}','draft',$3) RETURNING id`, [org, batch.id, rid]);
  await rejects('a mesma intenção não cria segundo pacote', `INSERT INTO public.payroll_email_packages (organization_id, batch_id, audience, subject, html_body, attachment_ids, status, request_id)
    VALUES ($1,$2,'custom','s','h','{}','draft',$3)`, [org, batch.id, rid], /payroll_email_packages_request/);
}
