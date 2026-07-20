# Insight Apex — Travel Eligibility by Municipality and Weekly PDF Exports

> Implementation specification and Codex prompt for extending the existing **Diárias de Campo** module.
>
> Scope:
> 1. Travel eligibility based on the employee’s validated home municipality versus the municipality where the service is performed.
> 2. Server-side PDF exports for the approved weekly allowance plan.
>
> Explicitly out of scope:
> - Alelo integration
> - banking integration
> - automatic deductions
> - automatic compensation rules

---

# Codex Prompt

You are a senior enterprise software architect and engineer working on the Insight Apex repository.

Your task is to extend the existing “Diárias de Campo” module with:

1. Travel eligibility based on the employee’s validated home municipality versus the municipality where the service is performed.
2. Server-side PDF exports for the approved weekly allowance plan.

This task does NOT include Alelo integration, banking integration, automatic deductions, or automatic compensation rules.

## Current module status

The existing module is already implemented and merged:

- Phase 1 — Weekly Planning
- Phase 2 — Approval workflow and segregation of duties
- Phase 3 — Payment batch and CSV export
- Phase 4 — Reconciliation
- Phase 5 — Intelligence and cost by project
- Playwright end-to-end validation
- Migrations 056–061 already applied
- Seven module tabs are active
- TypeScript, ESLint, verification suite, and E2E are currently green

Preserve all existing functionality and avoid regressions.

## Mandatory architectural decisions

### 1. Eligibility based on municipality

Meal allowance is available only to employees who are traveling and performing services outside their validated home municipality.

An employee must not receive the allowance when:

```text
validated residence municipality
==
service execution municipality
```

An employee may continue through the remaining eligibility checks when:

```text
validated residence municipality
!=
service execution municipality
```

Do not compare free-text city names.

Use a stable official municipality identifier, preferably the Brazilian IBGE municipality code.

Example:

```text
municipality_code: "4113700"
municipality_name: "Londrina"
state_code: "PR"
```

### 2. Residence must not be inferred from GPS

Do not use geolocation, attendance location, or device history to determine where an employee lives.

Residence municipality must come from a validated HR source.

Only municipality, state, validity period, source, and validation metadata should be exposed to the allowance domain.

Do not expose or duplicate the employee’s full residential address.

### 3. Service municipality must come from the operational site

The repository does not have a separate `worksites` table.

The current architecture uses:

- `projects`
- `project_geofences`

For this phase, continue using `project_geofences` as the operational site / worksite reference.

Add municipality metadata to the geofence if it does not already exist.

A daily allowance should continue referencing:

```text
project_id
project_geofence_id
```

Do not introduce a new `worksites` table in this task.

Do not permanently hardcode the assumption that a geofence is a full business entity called “worksite”. Keep the domain abstraction as “operational site” where practical.

## Required domain behavior

The weekly eligibility flow must evaluate, in the appropriate existing order:

```text
active employment
active project allocation
applicable allowance policy
scheduled or derived workday
no leave or absence
no prior demobilization
valid residence municipality
valid service municipality
different municipalities
no duplicate daily allowance
```

### Municipality results

If residence and service municipality codes are equal:

```text
status: blocked
reason: same_residence_and_service_municipality
```

If the codes are different:

```text
status: eligible for the remaining allowance validations
reason: service_outside_residence_municipality
```

If the employee’s residence municipality is missing or not validated:

```text
status: under_review
reason: missing_or_unvalidated_residence_municipality
```

If the service municipality is missing:

```text
status: under_review
reason: missing_service_municipality
```

Missing data must never result in automatic approval.

### Historical snapshot

Every generated `DailyAllowance` must preserve the municipality evidence used at decision time.

The snapshot must include, where available:

- residence municipality code;
- residence municipality name;
- residence state;
- residence source;
- residence validity period;
- residence validation metadata;
- service municipality code;
- service municipality name;
- service state;
- project geofence ID;
- service municipality source;
- eligibility result;
- rule version;
- evaluation timestamp.

A later change in HR or geofence data must not silently change the historical reason for an already generated allowance.

## Suggested residence model

First inspect the repository for an existing person address, HR profile, employment, or municipality structure that can be safely reused.

Do not create a duplicate domain unnecessarily.

If no suitable versioned structure exists, propose and implement a minimal model equivalent to:

```ts
interface PersonResidenceMunicipality {
  id: string;
  organization_id: string;
  person_id: string;

  municipality_code: string;
  municipality_name: string;
  state_code: string;

  valid_from: string;
  valid_until?: string;

  source:
    | "hr_registration"
    | "employee_declaration"
    | "migration"
    | "manual_adjustment";

  status:
    | "pending_validation"
    | "validated"
    | "expired";

  verified_by?: string;
  verified_at?: string;

  created_at: string;
  updated_at: string;
}
```

The database must prevent ambiguous overlapping validated residence periods for the same employee where practical.

## Project geofence municipality

Inspect the current `project_geofences` schema.

If municipality fields do not exist, add fields equivalent to:

```ts
municipality_code?: string;
municipality_name?: string;
state_code?: string;

municipality_source?:
  | "manual"
  | "reverse_geocoding"
  | "migration";

municipality_verified_at?: string;
municipality_verified_by?: string;
```

Do not execute reverse geocoding dynamically during weekly allowance generation.

Municipality information must be persisted and validated before it is used for automatic eligibility.

## Policy configuration

The municipality rule must be configurable in the allowance policy and must not be globally hardcoded for every allowance type.

Introduce or adapt policy settings equivalent to:

```ts
travel_eligibility_mode:
  | "different_municipality"
  | "not_required"
  | "manual_review";

residence_municipality_required: boolean;
service_municipality_required: boolean;
```

For the current meal allowance policy, use:

```text
travel_eligibility_mode = different_municipality
residence_municipality_required = true
service_municipality_required = true
```

Preserve policy versioning and historical reproducibility.

## Manual overrides

Support an auditable include or exclude override for exceptional cases.

Examples:

- emergency assignment;
- temporary relocation;
- incorrect HR municipality pending correction;
- work outside a configured geofence;
- temporary operational base;
- special business authorization.

An override must include:

- person;
- allowance date;
- project;
- optional geofence;
- include or exclude action;
- reason;
- requester;
- approver;
- approval timestamp;
- audit event.

An override must never silently replace the original eligibility evidence.

## UI changes

Update the weekly planning and evidence UI without making the main table excessively wide.

The UI should expose, where appropriate:

- home municipality;
- service municipality;
- travel eligibility result;
- missing municipality warning;
- same-city block;
- approved exception;
- evidence source.

Suggested statuses:

```text
Travel eligible
Same municipality
Residence not validated
Service municipality missing
Manual exception
```

The detailed municipality evidence should be available in the existing drawer.

Example:

```text
Travel eligibility

Validated home municipality:
Londrina — PR
Source: HR registration

Service municipality:
Telêmaco Borba — PR
Source: operational geofence

Comparison:
Different municipality codes

Result:
Eligible for meal allowance
```

Respect existing permissions and data minimization.

## PDF export requirements

Add server-side PDF generation based on the immutable approved weekly version.

Do not generate the official PDF from transient frontend state.

Create two report types:

### A. Weekly Financial Summary

Include only employees and daily allowances included in the approved weekly batch.

The PDF must contain:

- company or organization identification;
- report title;
- week start and end;
- weekly batch code;
- weekly version;
- execution mode;
- approval status;
- generation timestamp;
- generated-by user;
- number of employees;
- number of daily allowances;
- number of projects;
- total amount;
- subtotal by project;
- employee-level values;
- employee identifier or registration number;
- employee name;
- project;
- service municipality;
- number of eligible days;
- unit allowance amount;
- employee total;
- general total;
- page number;
- document hash or verification code.

Do not include the employee’s full residential address.

The financial summary does not need to expose the home municipality unless required by an authorized business rule.

### B. Audit Report

Include:

- eligible records;
- blocked records;
- records under review;
- home municipality evidence;
- service municipality evidence;
- policy and rule version;
- eligibility decision;
- blocking reasons;
- manual overrides;
- approval history;
- weekly version;
- reconciliation result;
- relevant audit metadata.

The audit report must be permission-restricted.

### Approved report identification

For an approved operational report, clearly display:

```text
APPROVED WEEKLY ALLOWANCE SUMMARY
```

## PDF persistence

Inspect the repository for existing document export, storage, hashing, or signed-document infrastructure before creating anything new.

Persist export metadata equivalent to:

```ts
interface AllowanceReportExport {
  id: string;
  organization_id: string;
  allowance_week_id: string;

  report_type:
    | "financial_summary"
    | "audit_report";

  week_version: number;
  execution_mode: "shadow" | "assisted" | "live";

  file_path: string;
  file_hash: string;

  generated_by: string;
  generated_at: string;
}
```

Repeated requests for the same immutable approved version should be idempotent or explicitly versioned.

## Security requirements

Preserve and extend:

- multitenancy;
- RLS;
- RBAC;
- ABAC where already used;
- segregation of duties;
- audit events;
- immutable approved versions;
- idempotency;
- live-first behavior.

Ensure:

- only authorized HR roles can validate residence municipality;
- project or operations roles can manage service municipality only within their allowed scope;
- financial summary export follows existing financial permissions;
- audit export is more restricted;
- full residential addresses are never exposed in allowance reports;
- cross-tenant access is impossible;
- manual overrides require explicit authorization;
- all sensitive reads and mutations are auditable where supported.

## Implementation process

Before editing code:

1. Inspect the current repository.
2. Identify the exact files, routes, services, selectors, tables, migrations, RLS policies, types, tests, and exports involved.
3. Inspect migrations 056–061 and the current Diárias domain.
4. Inspect the current `project_geofences`, person, employment, allocation, policy, daily allowance, weekly allowance, audit, approval, storage, and export models.
5. Reuse existing infrastructure.
6. Identify any mismatch between this specification and the real repository.
7. Produce a concise implementation plan based on the actual code.
8. Then implement the approved scope.

Do not create parallel or duplicate architecture when an existing mechanism can be extended.

Do not add mock production data.

Do not implement Alelo integration, bank integration, automatic deduction, or automatic compensation.

## Testing requirements

Add or update:

### Unit tests

- same municipality is blocked;
- different municipalities continue eligibility;
- missing residence municipality enters review;
- unvalidated residence municipality enters review;
- missing service municipality enters review;
- historical snapshot remains unchanged after source data changes;
- manual include override;
- manual exclude override;
- policy where municipality comparison is not required.

### Integration tests

- weekly generation with municipality rules;
- policy versioning;
- approved-week snapshot;
- duplicate prevention;
- tenant isolation;
- RLS for HR municipality data;
- RLS for geofence municipality data;
- PDF metadata persistence;
- repeated PDF generation behavior.

### PDF tests

Validate:

- weekly period;
- version;
- employee totals;
- project subtotals;
- general total;
- service municipality;
- approved-mode label;
- document hash metadata;
- permission enforcement.

### End-to-end tests

Extend the existing Diárias Playwright flow to cover:

1. Configure or validate an employee home municipality.
2. Configure an operational geofence municipality.
3. Generate the weekly preview.
4. Verify a same-city employee is blocked.
5. Verify an employee working in another city is eligible.
6. Verify missing municipality data enters review.
7. Approve the weekly flow using existing segregation of duties.
8. Export the weekly financial PDF.
9. Confirm a real PDF download.
10. Open or validate the report metadata.
11. Confirm existing tabs and workflows still work.

## Validation

Run all repository-standard checks, including the equivalents of:

```text
TypeScript type checking
ESLint
existing verification suite
unit tests
integration tests
Playwright E2E
production build
```

Do not declare completion unless all relevant checks pass.

## Final response

After implementation, report:

- architectural decisions;
- reused components;
- migrations added;
- RLS changes;
- files changed;
- UI changes;
- eligibility rules implemented;
- PDF implementation;
- tests added;
- exact validation results;
- remaining business or legal decisions;
- any deliberately deferred scope.
