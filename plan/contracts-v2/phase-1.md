# Contracts V2 — Phase 1 Implementation Record

Phase: **Canonical Party & Tenant Foundation**

Status:
- implementation complete
- production migrations 102–107 applied
- tests green
- verify merge into `main` before Phase 2

## 1. Production facts confirmed

Before apply:
- organizations: 1
- client: 0
- supplier: 0
- business_unit: 0
- cost_center: 0
- finance_cost_centers: 8 seeded rows
- ledger_entry: 0
- allocation_rule: 0
- contracts: 6
- contracts with free-text counterparty: 6
- contracts with client_id: 0
- contracts with supplier_id: 0
- fiscal_parties: absent
- migration 090: not applied

No identity rows required migration.

## 2. Migrations

### 102 — platform parties
Creates `parties`, `party_roles`, vocabulary, RLS, same-org role FK integrity, deterministic document uniqueness.

### 103 — Party permissions
Seeds `parties.*` permissions using existing Apex authorization patterns.

### 104 — tenant isolation
Hardens `client` and `business_unit`, adds organization ownership and tenant-scoped RLS. Does not edit migration 090.

### 105 — canonical cost center
Promotes `finance_cost_centers` to canonical. Adds `parent_id`, `business_unit_id`, `type`. Repoints `ledger_entry.cost_center_id` and `allocation_rule.cost_center_id`. Keeps legacy `cost_center`.

### 106 — canonical contract counterparty
Adds nullable `contracts.counterparty_party_id`, preserves `counterparty_name`, no backfill, no fuzzy linking.

### 107 — business-unit tenant FK correction
Adds same-org structural enforcement:

```text
finance_cost_centers
(organization_id, business_unit_id)
→
business_unit
(organization_id, id)
```

Migration 105 was not rewritten after production apply.

## 3. Canonical Party

`parties` supports:
- id
- organization_id
- kind
- legal_name
- trade_name
- document_type
- document_number
- generated document_normalized
- country_code
- active
- notes
- source_system
- external_key
- created_by / updated_by
- timestamps

Deterministic uniqueness:

```text
(organization_id, document_type, document_normalized)
```

where `document_normalized IS NOT NULL`.

No uniqueness on legal name. Names are not identity.

`foreign` document text is not treated as deterministic identity.

## 4. Party roles

Current vocabulary:
- customer
- supplier

Contract-relative roles remain out of global `party_roles`.

## 5. Contracts counterparty compatibility

Resolution precedence:

```text
canonical Party
→ historical contract text
→ missing
```

Existing contracts remain text-only until explicitly linked.

No auto-link, no fuzzy matching.

## 6. Trust/provenance

`parties` is a `LiveSource` because it represents physical read provenance, not confidence.

Trust state semantics remain unchanged:

```text
missing ≠ zero
missing ≠ compliant
missing ≠ verified
```

## 7. Canonical cost center

`finance_cost_centers` supports:
- parent_id
- business_unit_id
- type

The 8 seeded rows were not assigned invented values, so these remain nullable where evidence is absent.

Same-org integrity exists for:
- parent cost center
- business unit

Direct self-parenting is rejected. Deeper hierarchy-cycle prevention is deferred.

## 8. Tenant hardening

No `USING(true)` remains on Phase 1 boundary tables.

RLS and structural same-org FKs are both used where necessary.

## 9. Audit behavior

Migrations did not fabricate audit actors.

Runtime Party creation can write authenticated audit events.

## 10. Data migration result

- production rows migrated: 0
- existing contracts auto-linked: 0
- fuzzy matching: none
- demo data promoted: none

## 11. Deferred from Phase 1

- client.party_id
- supplier.party_id
- dropping legacy contracts.client_id/supplier_id
- dropping cost_center
- payroll cost-center text bridge conversion
- classifying seeded cost-center type
- assigning seeded cost centers to BUs
- deeper cost-center hierarchy cycle prevention
- Party roles beyond customer/supplier
- contract-scoped Party relationships
- Party addresses/contacts
- future fiscal_parties.party_id
- finance cost-center mock shim cleanup
- project cliente fallback cleanup
- unrelated pre-existing sidebar lint issue

## 12. Phase 2 gate

Before Phase 2:
- confirm Phase 1 merged into main
- confirm migrations 102–107 represented in main
- confirm production green
- create Phase 2 branch from updated main
