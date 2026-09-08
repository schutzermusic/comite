# Production domain migration: insightapex.co

Canonical application origin: `https://insightapex.co`.

The authenticated application continues to use root-relative routes (for
example `/login`, `/financeiro`, `/projetos` and `/contratos`). The employee
time-tracking portal remains separate at `https://ponto.insightapex.co`.

## Environment variables

Configure each deployment environment independently:

| Environment | `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` |
|---|---|
| Production | `https://insightapex.co` |
| Local | `http://localhost:9002` |
| Staging | The exact staging HTTPS origin |

Keep `NEXT_PUBLIC_PONTO_URL=https://ponto.insightapex.co`. Redeploy after changing
public variables because Next.js embeds `NEXT_PUBLIC_*` values at build time.
Production mobile builds must use
`EXPO_PUBLIC_API_BASE_URL=https://insightapex.co` for `/api/mobile/*` calls.

## Vercel and DNS

1. Add and verify `insightapex.co`, `www.insightapex.co`, and
   `board.insightapex.co` on the same Vercel project.
2. Mark `insightapex.co` as the primary production domain.
3. Point the apex A/ALIAS record and the `www` and `board` CNAME records to the
   targets shown by Vercel. Do not remove `board` while old links are in use.
4. The repository's `vercel.json` redirects `board` and `www` to the apex. The
   middleware repeats this canonicalization as an application-level safeguard.
   Both preserve the path and query string.
5. Confirm Vercel has issued TLS certificates for all three hosts before testing
   redirects.

## Supabase Auth dashboard

In Authentication -> URL Configuration:

- Site URL: `https://insightapex.co`
- Redirect URLs:
  - `https://insightapex.co/**`
  - `https://ponto.insightapex.co/**`
  - `http://localhost:9002/**`
  - each explicit staging/preview origin still supported

Keep `https://board.insightapex.co/**` temporarily only if already-sent Auth
emails can still contain that origin. New application links use the apex. Remove
the legacy allow-list entry after the longest invite/recovery token lifetime and
after outstanding links have expired.

Review Authentication -> Email Templates for confirmation, recovery, magic-link
and invitation templates. Templates should use Supabase's `RedirectTo` or
`ConfirmationURL` variables rather than a hardcoded host. The application sends
admin invitations to `/welcome`, password recovery through
`/auth/callback?next=/reset-password`, and Ponto activation to `/ponto/ativar`.

If an OAuth provider is enabled, add Supabase's provider callback URL shown in
Authentication -> Providers to the provider console. Application post-auth
destinations must use an allow-listed apex/staging URL. No OAuth sign-in call is
present in this repository at the time of this audit.

## Validation checklist

- Anonymous deep link redirects to `/login?next=...`, including its query, and
  returns to the same internal path after login.
- Login, logout, refresh/session persistence, invite acceptance, recovery and
  email confirmation work on the apex.
- Protected pages still enforce middleware permissions and database RLS.
- `board` and `www` return a permanent redirect to the identical apex path/query.
- Ponto host routing and activation links remain on `ponto.insightapex.co`.

Browser sessions stored in host-only cookies cannot be transferred from `board`
to the apex by an HTTP redirect. Existing users may need to authenticate once on
the new apex; subsequent session persistence is unchanged.
