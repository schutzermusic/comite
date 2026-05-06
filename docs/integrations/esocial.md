# eSocial Integration Foundation

Task: `ESOCIAL-HUBCOUNT-LIKE-001`

Reference engine: [`nfephp-org/sped-esocial`](https://github.com/nfephp-org/sped-esocial)

The eSocial integration is a central data layer for payroll and workforce intelligence. It is not owned only by Financeiro. The normalized layer feeds:

- Pessoas & Custos: headcount, active employees, admissions, terminations, tenure, turnover, PJ vs CLT mapping, overtime ranking, cost per employee, department concentration and alerts.
- Financeiro > Folha & Alocacao: gross payroll, remuneration by period, rubrics, overtime, benefits, tax/charge bases where available, cost center/project allocation, payroll batches, budget vs actual and DRE impact.

## Current Scope

Implemented in this foundation:

- UI entry point at `/configuracoes/integracoes/esocial`.
- Provider and GitHub reference metadata.
- Automatic sync UI for company CNPJ, environment, A1 certificate file, certificate password, frequency and schedule.
- Certificate sync service interface with safe mock/stub implementation.
- Safe API route stubs for health, certificate validation, sync-now, events, summaries and schedule.
- Manual XML import UX foundation as fallback.
- TypeScript models for eSocial raw and normalized payroll/workforce structures.
- BI aggregation interfaces for workforce and payroll summaries.
- Source badges in Pessoas & Custos and Financeiro > Folha & Alocacao.

Not implemented yet:

- Production SOAP calls.
- Certificate file upload/storage.
- Database migrations.
- Real encrypted XML object storage.

## Environment Variables

Never commit real values. Keep `.env`, `.env.local`, `.pfx`, `.p12` and raw XML files outside version control.

```bash
ESOCIAL_PROVIDER=nfephp-org/sped-esocial
ESOCIAL_ENGINE_URL=
ESOCIAL_ENV=production|homologation
ESOCIAL_CERT_PATH=
ESOCIAL_CERT_PASSWORD=
ESOCIAL_COMPANY_CNPJ=
ESOCIAL_TRANSMITTER_CNPJ=
ESOCIAL_STORAGE_PATH=
```

## Data Model Layer

TypeScript models live in `src/lib/esocial/types.ts`:

- `esocial_sync_runs`
- `esocial_raw_events`
- `esocial_protocols`
- `esocial_workers`
- `esocial_employment_links`
- `esocial_payroll_events`
- `esocial_payroll_rubrics`
- `esocial_payments`
- `esocial_absences`
- `esocial_terminations`
- `payroll_monthly_snapshots`
- `payroll_cost_allocations`
- `payroll_rubric_classifications`

The mock repository in `src/lib/esocial/mock-repository.ts` exists only to drive the UI and service contracts until persistence is wired.

## Automatic A1 Sync Contract

Main mode:

1. User configures company CNPJ, transmitter CNPJ where applicable, environment, A1 `.pfx/.p12` certificate and certificate password.
2. Next.js validates only safe metadata and never displays the password after save.
3. PHP bridge reads certificate path/password from secure server-side config or secret manager.
4. PHP bridge validates the PKCS#12 certificate, checks expiration and tests SOAP connectivity.
5. Sync runs by competence/period and consults/sends/receives eSocial XML events, batches and protocols where supported.
6. Raw XML and return XML are stored only in non-public secure storage.
7. Next.js receives safe metadata and normalized JSON.
8. Payroll/workforce aggregators feed Pessoas & Custos and Financeiro > Folha & Alocacao.

Relevant event families prepared:

- `S-2200` / `S-2300`: worker registration/admission.
- `S-2206`: contract changes.
- `S-2230`: absence/leave.
- `S-1200`: remuneration.
- `S-1210`: payment.
- `S-2299`: termination.
- `S-2399`: termination without employment relationship.
- `S-5001` and related totalizers where available.
- `S-3000`: exclusions/cancellations.

## Manual XML Import Contract

Fallback mode:

Target flow:

1. Upload multiple eSocial XML files.
2. Validate XML envelope and event node.
3. Identify event type such as `S-1200`, `S-1210`, `S-2200`, `S-2299`.
4. Calculate content hash and ignore duplicates.
5. Store raw XML in secure private storage only.
6. Normalize safe fields into workers, links, payroll events, rubrics, payments, absences and terminations.
7. Display summary: files processed, events imported, duplicates ignored, errors/rejections and detected period.

UI and logs must never expose raw XML, certificate path, certificate password or unmasked CPF/CNPJ.

## Automatic Certificate Sync Contract

The Next.js app should not own risky production SOAP operations directly. Use a PHP bridge based on `nfephp-org/sped-esocial` for certificate loading, XML signing, batch submission and protocol consultation.

Supported integration shapes:

- Internal HTTP service: Next.js calls a private PHP service over the internal network.
- CLI worker: scheduler invokes a PHP command with period/environment arguments.
- Scheduled job: cron/queue dispatches sync by competence.
- Queue worker: Next.js enqueues sync/import jobs, PHP consumes them.
- Webhook/result callback: PHP posts safe run status and secure storage keys back to Next.js.

Suggested internal endpoints:

- `GET /api/integrations/esocial/health`
- `POST /api/integrations/esocial/validate-certificate`
- `POST /api/integrations/esocial/sync-now`
- `GET /api/integrations/esocial/sync-runs`
- `GET /api/integrations/esocial/events`
- `GET /api/integrations/esocial/workforce-summary`
- `GET /api/integrations/esocial/payroll-summary`
- `PATCH /api/integrations/esocial/schedule`

Optional fallback endpoint for manual XML import:

- `POST /api/integrations/esocial/import-xml`

## Security Rules

- Never hardcode certificate password.
- Never commit `.pfx` or `.p12`.
- Never commit `.env` files.
- Do not expose certificate path publicly.
- Store XML only in secure non-public storage.
- Mask CPF/CNPJ in UI, logs and safe metadata.
- Separate production and homologation configuration.
- Show certificate expiration warnings.
- Log only safe metadata, event type, period, counts, status, protocol references and storage keys.

## Rubric Classification

Rubrics normalize into:

- `base_salary`
- `overtime`
- `bonus`
- `benefits`
- `vacation`
- `thirteenth_salary`
- `termination`
- `taxes_charges`
- `deductions`
- `other`

Rules should be explicit and auditable. Unknown rubrics must fall into `other` and appear in the rejection/error console for finance classification.
