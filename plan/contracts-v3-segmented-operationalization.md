# Contracts V3 — Segmented Contract Operationalization

**Status:** ARCHITECTURE SPEC. No code, no migration, no deployment, no provider call.
**Supersedes (behaviourally, not historically):** the monolithic single-call
`CONTRACT_OPERATIONALIZATION` path in `src/lib/ai/contract-operationalization.ts`.
**Does not supersede:** clause extraction, which stays independent and untouched.

---

## 0. The failure this exists to remove

`JA10182283` is ~195 pages.

The split introduced by migration 168 worked exactly as designed: the dedicated
`contracts.contract_operationalization.execute` job ran **once**, alone in its own
invocation, with a whole function lifetime to itself. It still died — not because the
orchestration was wrong, but because **one provider call over 195 pages with
`maxTokens: 32_000` cannot finish inside 180s**. The job reached `DEAD_LETTER` with
`p_max_attempts: 1` (`OPERATIONALIZATION_JOB_MAX_ATTEMPTS`, `src/lib/platform/jobs/budget.ts`).

Clause extraction for the same document completed and persisted **38 clauses**. Those
are correct, durable, and out of scope here.

Two non-solutions are explicitly rejected:

1. **Raise the timeout.** `LONG_PROVIDER_TIMEOUT_MS` (180s) + `PERSISTENCE_MARGIN_MS`
   (45s) = 225s already, against an `APEX_CONFIGURED_HOST_CEILING` of 300s. There is
   ~75s of slack total, and the drain budget (50s) consumes most of it. 480s/600s means
   Vercel Pro. Rejected.
2. **Shrink `maxTokens`.** A truncated reading of a contract is indistinguishable from a
   complete one. `budget.ts` already says this in prose; this spec does not undo it.

The defect is **unbounded work per provider call**. The fix is to bound the work, not the
clock.

---

## 1. Product invariant (unchanged)

```
UPLOAD PDF → Apex processes automatically → one progress experience → one consolidated contractual result
```

The user never sees, names, retries, orders, or consolidates a segment. Segmentation is
**internal infrastructure**. The user-facing object remains ONE operationalization of ONE
document, with ONE analysis in `contract_ai_analyses` that they can point at.

---

## 2. Target pipeline

```
SIGNED PDF (documentary truth)
  │
  ├─ clause extraction .............................. independent, already complete, untouched
  │
  └─ OPERATIONALIZATION RUN (persistent, top-level)
       │
       ├─ PLANNING ......... download → sha256 → authoritative page count → deterministic
       │                     segmentation → N segment rows → N segment jobs
       ├─ PROCESSING ....... per segment: in-memory page subset → ONE bounded Sonnet call
       │                     → evidence gate → page remap → STAGING rows
       ├─ CONSOLIDATING .... deterministic collapse over staging (page ownership +
       │                     evidence containment); no AI
       ├─ MATERIALIZING .... ONE transaction: interpretations + canonical facts +
       │                     obligation instances + run/analysis completion
       └─ COMPLETED | PARTIALLY_FAILED | FAILED | CANCELLED
```

Canonical outputs are unchanged:
`contract_obligation_definitions`, `contract_billing_conditions`, `contract_guarantees`,
`contract_insurance_requirements`, `contract_indexation_rules`.

---

## 3. Run model

### 3.1 States

| State | Meaning | Terminal |
|---|---|---|
| `PLANNING` | Run row exists; document being hashed, counted, segmented. No provider call yet. | no |
| `PROCESSING` | All segment rows and segment jobs exist. At least one segment is not terminal. | no |
| `CONSOLIDATING` | Every required segment is terminal and at least one succeeded. Deterministic collapse in progress. | no |
| `MATERIALIZING` | Consolidation produced a canonical set; the single materialization transaction is open. | no |
| `COMPLETED` | Canonical materialization committed. The contract is operationalized. | **yes** |
| `PARTIALLY_FAILED` | All segments terminal, at least one `FAILED`. **Nothing canonical was written.** Deliberate recovery required. | **yes** |
| `FAILED` | The run cannot proceed at all (planning failed, PDF unreadable, zero segments succeeded, materialization rejected). Nothing canonical written. | **yes** |
| `CANCELLED` | Explicitly cancelled by an authorized operator before materialization. | **yes** |

### 3.2 Legal transitions

```
PLANNING ──▶ PROCESSING ──▶ CONSOLIDATING ──▶ MATERIALIZING ──▶ COMPLETED
   │              │                │                 │
   │              │                │                 └──▶ FAILED        (transaction rejected)
   │              │                └──▶ FAILED                          (zero usable items / gate refusal)
   │              └──▶ PARTIALLY_FAILED                                 (all terminal, ≥1 FAILED)
   │              └──▶ FAILED                                           (all segments FAILED)
   └──▶ FAILED                                                          (planning could not produce a plan)

any non-terminal ──▶ CANCELLED   (authorized operator only)
```

Enforced by a `CHECK` on `(status, completed_at)` coherence plus an `UPDATE` trigger that
rejects any transition not in the table above. **No terminal state may transition to a
non-terminal state.** Retrying a failed run creates a **new run row** (new
`recovery_generation`), it never resurrects the old one — the same discipline
`contract_clause_extraction_requests` uses.

### 3.3 Terminal semantics

- `COMPLETED` is the **only** state in which the product may say the contract is
  operationalized. `PARTIALLY_FAILED` is not "mostly done"; it is "not done".
- A terminal run never mutates canonical rows again.
- A new run that fails leaves the previous `COMPLETED` run's canonical rows **untouched**:
  materialization is insert-only with `ON CONFLICT DO NOTHING`, and no path in this design
  deletes or updates a canonical operational fact.

### 3.4 Concurrency guard

At most **one non-terminal run per (organization_id, contract_id, document_id)**, enforced
by a partial unique index. Two uploads, two clicks, two drains converge on the same run.

---

## 4. Segment model

One row per segment in `contract_operationalization_segments`, organization-scoped:

| Concern | Field |
|---|---|
| run identity | `run_id`, `organization_id`, `contract_id`, `source_document_id` |
| segment index | `segment_index` (0-based, dense, `UNIQUE (run_id, segment_index)`) |
| source page range | `page_start`, `page_end` (1-based, **global**, inclusive) |
| overlap | `overlap_before` (pages shared with the previous segment) |
| ownership | `owned_page_start` = `page_start + overlap_before`, `owned_page_end` = `page_end` (generated columns) |
| fingerprint | `segment_fingerprint` (sha256, §15) |
| status | `PENDING → RUNNING → SUCCEEDED \| FAILED \| SKIPPED_REUSED \| CANCELLED` |
| execution job | `execution_job_id` → `apex_jobs (organization_id, id)` |
| analysis provenance | `analysis_id` → `contract_ai_analyses (organization_id, id)` (the *child* technical analysis) |
| accepted output | staging rows in `contract_operationalization_staging_items`, FK to this segment |
| rejected output | `rejected_payload jsonb` (bounded, capped count — evidence-gate rejections, verbatim reasons) |
| recovery | `recovery_generation integer NOT NULL DEFAULT 0` (bumped only by deliberate recovery) |
| future amendments | `invalidated_at`, `invalidation_reason` (reserved, unused in V1) |
| timestamps | `created_at`, `started_at`, `completed_at` |
| accounting | `provider`, `model`, `input_tokens`, `output_tokens`, `duration_ms`, `error_code`, `error_safe` |

Invariants enforced in SQL:

- `page_start >= 1`, `page_end >= page_start`, `page_end <= run.page_count`.
- `owned_page_start <= owned_page_end`.
- Segment 0 has `overlap_before = 0`.
- Segment `k` (k>0) satisfies `page_start = previous.page_end - overlap_before + 1`.
- The union of `[owned_page_start, owned_page_end]` over a run is **exactly** `[1, page_count]`
  with no gap and no overlap. Verified by a run-level assertion at the end of PLANNING and
  by unit test on the pure segmentation function.

---

## 5. Segmentation algorithm (deterministic, no AI)

```
SEGMENT_PAGES  = 16
SEGMENT_OVERLAP = 2
STRIDE = SEGMENT_PAGES - SEGMENT_OVERLAP = 14
MAX_SEGMENTS_PER_RUN = 60          (hard stop — FAILS CLOSED, see §5.2)
```

Pure function `planSegments(pageCount): Segment[]` — no I/O, no clock, no randomness,
fully unit-testable:

```
segments = []
start = 1
index = 0
while start <= pageCount:
    end = min(start + SEGMENT_PAGES - 1, pageCount)
    overlapBefore = index === 0 ? 0 : SEGMENT_OVERLAP
    segments.push({ index, pageStart: start, pageEnd: end, overlapBefore })
    if end === pageCount: break
    start = end - SEGMENT_OVERLAP + 1
    index += 1
```

Tail rule: if the final segment would own fewer than `SEGMENT_OVERLAP + 1` pages, it is
**merged into the previous segment** (which then spans up to `SEGMENT_PAGES + STRIDE - 1`
pages). A 2-page tail segment whose pages are all overlap would own nothing and would be a
pure duplicate call.

### 5.1 Why 16 / 2

- **Measured anchor.** The monolithic call is 195 pages with `maxTokens: 32_000` and
  exceeds 180s. Generation dominates. A 16-page segment is ~8% of that document; with
  `maxTokens: 8_000` (§6) the expected wall time is ~15–40s, against a 120s segment
  timeout — roughly 3–5× headroom, not 1.1×.
- **Page count.** 195 pages → **14 segments** (13 × stride 14 = 182, + tail). Under
  `MAX_SEGMENTS_PER_RUN`.
- **Overlap of 2 is a reading aid, not a dedupe crutch.** A clause that begins at the
  bottom of page *p* and completes on *p+1* must be readable in one call. Two pages covers
  a page break plus the preceding paragraph. It is **not** used to reconcile duplicates —
  page ownership (§9) does that structurally.
- **Rejected: 24/2** (9 segments). Fewer calls, but each is 1.5× the generation and lands
  near 60–120s — the same narrow-margin posture that caused this incident.
- **Rejected: 12/2** (19 segments). More per-call fixed overhead (system prompt, schema
  grammar compilation, PDF header) for no correctness gain; overlap waste rises to 17%.
- **Cost is ~1.15×, not 14×.** The whole document's pages are sent either way; segmentation
  re-sends only the overlap (2/16 ≈ 14%) plus a per-call system prompt. Output token volume
  is roughly conserved. This is the single most important economic fact in this spec and it
  must be verified against real gateway usage rows in the acceptance test.

Values live as exported constants beside `OPERATIONALIZATION_VERSION`, and are asserted in
tests (the `budget.ts` precedent: numbers that live only in comments rot silently).

---

### 5.2 Oversized documents FAIL CLOSED

`MAX_SEGMENTS_PER_RUN = 60` is accepted for V1. At 16/2 that is ~844 pages — comfortably
above JA10182283's 195 and above any contract this portfolio has produced.

**Exceeding it is a terminal, explicitly named refusal, never a silent reduction.**

When `planSegments(pageCount).length > MAX_SEGMENTS_PER_RUN`, PLANNING:

- writes **no** segment rows and enqueues **no** segment jobs;
- sets the run `FAILED` with `error_code = 'document_too_large'` and a safe, specific
  `error_safe`: *"O documento tem N páginas e excede o limite de M segmentos desta versão da
  operacionalização."* — it names the real numbers, because "falhou" without them sends
  whoever investigates to the provider instead of to the page count;
- sets the parent analysis `failed` with the same code;
- surfaces the UX state `Documento não suportado nesta versão` (§14), which is deliberately
  **not** the same label as a processing failure — one is "try again", the other is "this
  cannot be attempted as configured";
- makes no provider call whatsoever. The refusal costs nothing.

**Explicitly forbidden**, because each would produce a confident partial reading:

- truncating the document to the first `MAX_SEGMENTS_PER_RUN × STRIDE` pages;
- widening `SEGMENT_PAGES` on the fly so the count fits (that reintroduces the unbounded
  per-call work this whole design exists to remove);
- dropping "unimportant-looking" pages by any heuristic;
- materializing whatever the first 60 segments found and calling the run `COMPLETED`.

A contract whose last 200 pages were never read is not an operationalized contract, and the
canonical tables have no way to say "everything here is true, but the set is incomplete".
Refusing is the only honest option. Raising the limit is a deliberate, versioned decision
(it bumps `segmentation_version`, which invalidates reuse — §15), not an accident of input.

The same fail-closed posture already covers the other planning-time impossibilities:
`pdf-lib` cannot parse the file (encrypted/corrupt), `page_count` is 0, or `requested_by` is
null (§12). Each is a distinct `error_code`, each terminal at PLANNING, none has a fallback
to a whole-document call.

## 6. PDF handling

### 6.1 Authoritative page count

`countPdfPages()` in `src/lib/ai/contract-clause-extractor.ts` is a deliberately
best-effort regex over `/Type /Pages … /Count`, returning `null` when unsure. **That is not
good enough to define page provenance**, because segmentation turns the page count into a
coordinate system.

PLANNING therefore obtains the page count from the PDF object model (`pdf-lib`,
`PDFDocument.load(bytes).getPageCount()`), stores it on the run as `page_count`, and stores
`countPdfPages()`'s answer alongside as `page_count_heuristic` for diagnosis. If `pdf-lib`
throws (encrypted, corrupt, non-PDF), the run is **terminally FAILED at PLANNING**. There
is no fallback to a whole-document call.

`page_count` is what feeds the existing evidence gate's `pageCount` argument, unchanged.

### 6.2 Page subsets in memory

Per segment, the handler:

1. downloads the original PDF from the `contract-files` bucket (same path, same 30 MB cap);
2. verifies `sha256(bytes) === run.document_sha256` — **if it differs the segment fails
   terminally**, because the coordinate system it was planned against no longer exists;
3. builds a subset document in memory: `PDFDocument.create()` +
   `copyPages(source, [page_start-1 … page_end-1])`;
4. base64-encodes the subset and sends it as the `document` in one gateway call;
5. discards the buffer.

**No derived PDF is ever persisted.** The signed original stays the only stored document
and the only documentary truth. Storage cost, retention policy, erasure boundary
(migration 110) and the private-document policy (migration 150) are all unaffected.

New dependency: **`pdf-lib`** — pure JS, MIT, no native bindings, works in the Node
serverless runtime. This is the only new dependency in the design. `pdfjs-dist` (already
present) can read but cannot author a PDF, so it cannot do this job.

### 6.3 Page mapping — the provenance contract

The provider sees a document whose pages are numbered **1 … (page_end − page_start + 1)**.
The prompt states this explicitly and says nothing about the original document's numbering
(telling it "these are really pages 90–105" invites it to cite 97 for its own page 8).

Normalization maps, per item:

```
local = item.page                                   (as returned)
REJECT unless Number.isInteger(local) && 1 <= local <= segmentPageCount
global = page_start + (local - 1)
REJECT unless page_start <= global <= page_end      (redundant, kept as a belt)
```

Consequences:

- **The provider structurally cannot produce a valid item outside its own range.** The only
  number it controls is a local index bounded by the subset's own length; anything else is
  a rejected item with a recorded reason, never a clamped one.
- Rejection is per item, not per response — identical to the existing `evidenceOk` posture.
- Staging rows store `source_page` **already remapped to global**. Nothing downstream —
  consolidation, interpretations, canonical facts, the `ai_evidence->>'page' = source_page`
  CHECK from migration 160 — ever sees a local page number.
- Staging also keeps `segment_local_page` for forensics.

---

## 7. Segment AI task

### 7.1 Registration

New task `CONTRACT_OPERATIONALIZATION_SEGMENT` added to `APEX_AI_TASKS` and
`CURRENT_PRODUCTION_TASKS` (`src/lib/ai/gateway/`).

```ts
CONTRACT_OPERATIONALIZATION_SEGMENT: highRisk({
  maxTokens: 8_000,
  timeoutMs: 120_000,
  stream: false,
  maxAttempts: 1,          // fixed, infrastructure limit — same reason as the monolith
}),
```

- **Sonnet, no fallback.** `highRisk()` already supplies an empty `fallbacks` array and
  never hops to Opus automatically. Unchanged.
- **`maxAttempts: 1`.** Two 120s provider attempts inside one 300s function is the exact
  arithmetic that killed the earlier design. Repetition lives at the **job** level, where
  each attempt gets a whole new invocation.
- **`stream: false`.** 8k output is far under the SDK's ~21.3k non-streaming ceiling, so
  streaming buys nothing here and removes a moving part. (The monolith needed
  `stream: true` only because of its 32k budget.)
- **`maxTokens: 8_000`.** A 16-page slice of a contract producing more than ~8k tokens of
  compact transport (~30+ operational items in 16 pages) is itself a signal. 8k is
  acceptable **only** because truncation fails closed (§7.1.1); it is not a budget the
  reading is allowed to spend down into a partial answer.

#### 7.1.1 Truncation and incompleteness FAIL CLOSED — P0

**A truncated contract interpretation must never be presented as complete.** A short
reading and a complete reading are indistinguishable downstream: both are a list of
requirements with evidence. The only place the difference is knowable is the moment the
provider response is received, so that is where it is decided — once, explicitly, before
anything is persisted.

A segment execution **fails** — no staging write, no `SUCCEEDED`, no contribution to
consolidation, no path to canonical materialization — when **any** of the following holds:

| Condition | Detection |
|---|---|
| Output token limit reached | `stopReason === 'max_tokens'` |
| Any stop reason other than a clean completion | `stopReason ∉ { 'end_turn', 'stop_sequence' }` — an allow-list, not a deny-list, so a stop reason this codebase has never seen fails rather than passes |
| Response text does not parse as JSON | `JSON.parse` throws |
| Structured root is malformed | `OperationalTransportError` from `normalizeCompactContractOperationalization` (root without `items`, `items` not an array) |
| Response is empty | zero text blocks, or `items` absent entirely (note: an *empty* `items` array is a **legitimate, successful** reading — "this slice contains no operational requirement" is real information, and §7.3's prompt says so explicitly) |

The distinction in the last row matters and must be implemented exactly: `items: []` with a
clean stop reason is **success with zero items**. A missing `items` key, or `items` present
with a truncated stop reason, is **failure**. Conflating the two either invents emptiness
or refuses a valid negative finding.

**Classification.** Truncation is surfaced as a distinct, named error code
`segment_output_truncated`, never folded into a generic `PROVIDER_ERROR`. The V1 policy
classifies it **retryable** (`max_attempts: 2`, §8.2) on the reasoning that a truncated
response is usually a transient over-generation rather than a structural impossibility —
but retryability is a **policy decision declared in `classifyJobError`**, not a property
inherited from the provider's HTTP status. Malformed-transport failures
(`CONTRACT_OPERATIONALIZATION_TRANSPORT_INVALID`) are classified **terminal**: a response
shape that does not honour the transport contract will not honour it on the second try
either.

If a segment truncates on **both** attempts it reaches `FAILED`, the run reaches
`PARTIALLY_FAILED`, **nothing canonical is written**, and the segment's page range is
visibly un-read. That outcome is correct. A run that quietly materialized 13 of 14 slices
and called the contract operationalized would be the actual defect.

**No salvage path.** There is deliberately no "keep the items that did parse before the cut"
branch. The final item of a truncated response is arbitrarily severed, and the items that
never got generated are invisible — partial salvage produces exactly the false completeness
this rule exists to prevent.

### 7.2 Execution budget — dynamic admission, not a static sum — P0

```
SEGMENT_PROVIDER_TIMEOUT_MS   = 120_000
SEGMENT_PERSISTENCE_MARGIN_MS =  30_000
SEGMENT_JOB_WORST_CASE_MS     = 150_000
APEX_CONFIGURED_HOST_CEILING  = 300_000   (existing, unchanged)
```

**The invariant is not a sum of two constants. It is a condition re-evaluated before every
claim:**

```
elapsedSinceInvocationStart  +  SEGMENT_JOB_WORST_CASE_MS  <  APEX_CONFIGURED_HOST_CEILING
```

Equivalently, as the worker must express it:

```
hostRemainingMs()  >  worstCaseMsFor(nextJobClass)
```

where `hostRemainingMs()` is measured from the **invocation's** start instant against the
route's real `maxDuration`, not from the drain's own soft `timeBudgetMs`.

**Why the old phrasing was insufficient.** "50s drain budget + 150s job = 200s < 300s" is a
statement about the *worst case of the last possible claim*. It is true only if the worker
actually stops claiming at 50s and only if 50s is the real elapsed figure at claim time. It
says nothing about a claim attempted at t=180s, which is arithmetically fine under the sum
(180 < 300) and catastrophic in fact (180 + 150 = 330 > 300). A static assertion cannot
catch that; an admission check evaluated at the instant of claiming can, and does, because
it reads the clock rather than a constant.

**Two budgets, deliberately distinct:**

| Budget | Meaning | Who enforces |
|---|---|---|
| `timeBudgetMs` (soft, 50s) | when the worker *prefers* to stop starting new work, leaving the queue tidy | `drainOnce` loop |
| `hostRemainingMs()` (hard) | whether a claim is *permitted at all*, because the job's worst case must fit | admission check, §13.2 |

The hard check is authoritative. When the two disagree the hard check wins, in both
directions: it may refuse a claim the soft budget would allow, and it never authorizes one
the soft budget forbade.

**Per-job-class worst cases** are declared in `budget.ts` as a map, not a single global
constant, because the queue is now heterogeneous:

```
worstCaseMsFor('contracts.contract_operationalization.segment.execute') = 150_000
worstCaseMsFor('contracts.contract_operationalization.execute')         = 225_000   (legacy, still registered)
worstCaseMsFor(<anything else>)                                          =  30_000   (conservative default)
```

An unknown job type takes the conservative default rather than zero. A worst case of zero
for an unrecognized type would admit anything at any time, which is the failure mode this
whole mechanism exists to remove.

A job class whose worst case cannot fit in a *fresh* invocation
(`worstCaseMsFor(t) >= APEX_CONFIGURED_HOST_CEILING`) is a **design error**, asserted at
module load and in test — it could never be admitted by any worker and would sit `PENDING`
forever, invisible.

**No 480s/600s execution is proposed anywhere in this design.**

### 7.3 Domain model — reused, not forked

The segment task extracts the same five canonical families and reuses, verbatim:

- `OPERATIONALIZATION_SCHEMA` and the compact name/value transport (the schema-grammar fix
  is precisely what makes a second task cheap to add);
- `RESPONSIBLE_SIDES`, `ACTIVATION_KINDS`, `DUE_KINDS`, `CALENDAR_BASES`,
  `RECURRENCE_KINDS`, `SCHEDULE_ANCHORS`, `BILLING_CONDITION_TYPES`;
- `normalizeCompactContractOperationalization`, `normalizeObligation`, `normalizeGuarantee`,
  `assertOperationalEvidence`, `evidenceOk`;
- `operationalFingerprint`, `evaluateOperationalTrust`, `MIN_OPERATIONAL_CONFIDENCE`,
  `MATERIAL_OPERATIONAL_AMOUNT_BRL`.

The **only** additions are (a) the local→global page remap injected between transport
reconstruction and the evidence gate, and (b) a segment-scoped system prompt suffix stating
that the document is an excerpt, that absence of a family is expected and correct, and that
a requirement only partially visible at a boundary must be returned with the evidence that
*is* visible (the overlap exists for exactly that case).

`OperationalReading` and every canonical interface are untouched. There is no second domain
model.

---

## 8. Job graph

Three new types in `JOB_TYPES` / `JOB_SCHEMAS` (`src/lib/platform/jobs/registry.ts`), all
payload version 1, all carrying **identity only** (the 16 KB `aj_payload_small` cap and the
existing "payload carries identity, never content" rule):

### 8.1 `contracts.contract_operationalization.plan`

```ts
{ request_id: uuid, contract_id: uuid, document_id: uuid,
  requested_by: uuid.nullable(), operationalization_version: string,
  segmentation_version: string }
```

- **Idempotency key:** `contract-operationalization-plan:{contract_id}:{document_id}:{request_id}:{operationalization_version}:{segmentation_version}`
- **Enqueued by:** the existing `clauseExtraction` handler, replacing today's
  `enqueueContractOperationalization` target. The rest of that handler is untouched.
- **`max_attempts`: 3.** Planning makes **no provider call**; it is download + hash + count
  + inserts. Transient storage/DB errors deserve automatic retry.
- **Effect:** creates (or finds) the run row, computes `document_sha256` and `page_count`,
  writes segment rows, enqueues one segment job per non-reused segment, sets run
  `PROCESSING`. All of it in one RPC so a crash cannot leave a run with half its segments.
- **Failure:** terminal → run `FAILED` with `error_code`/`error_safe`; retryable → run stays
  `PLANNING`, job returns to the queue.

### 8.2 `contracts.contract_operationalization.segment.execute`

```ts
{ run_id: uuid, segment_id: uuid, segment_index: int,
  contract_id: uuid, document_id: uuid, requested_by: uuid.nullable(),
  operationalization_version: string, segmentation_version: string,
  recovery_generation: int }
```

- **Idempotency key:** `contract-operationalization-segment:{run_id}:{segment_index}:{recovery_generation}`
  Deterministic, no clock, no randomness (the `enqueueContractOperationalization` doctrine).
  `recovery_generation` is what lets a deliberate re-run of **segment 7 only** create a new
  job without colliding with the dead one.
- **`max_attempts`: 2.** One automatic retry, unlike the monolith's 1. Justified: a segment
  call is ~1/14th of the document, fanning out 14 calls makes transient `429`/`5xx`
  materially likely, and the wasted spend of one retry is ~7% of a run rather than 100% of
  it. Still bounded — never infinite.
- **Dependencies:** the run row must exist and be `PROCESSING`; the segment row must be
  `PENDING` or `RUNNING`-with-dead-lease. A segment whose run is terminal returns
  `{skipped: true}` and completes — it never calls the provider.
- **Tenant coherence before the provider call**, exactly as the current handler does:
  the run/segment must belong to `job.organization_id` or it is a `TerminalJobError`.
- **Staggered start:** segment *k* is enqueued with `run_after = now() + k * 5s` to spread
  the fan-out across provider rate limits and across drain passes.

#### 8.2.1 Generation-safe persistence — a retry must not accumulate stale staging — P0

A segment may be attempted more than once: an automatic job retry, a re-delivery after a
reaped lease, or a deliberate `recovery_generation` bump. Each attempt produces a **whole
reading of the same page range**. If two attempts' rows could coexist in staging,
consolidation would read a union of two readings — near-duplicates whose excerpts differ by
a few characters, which §9.2's exact-fingerprint rule would *not* collapse and §9.3's
boundary rule would *not* touch (they are not adjacent segments). The run would materialize
the same requirement twice, with impeccable provenance for both.

**The rule:** a segment has, at any instant, **at most one authoritative set of staging
rows**, and consolidation reads exactly that one.

**Attempt identity.** Every staging row carries `staging_generation`, a monotonic integer
scoped to the segment. It is **not** `recovery_generation` (which counts only *deliberate*
recoveries) and **not** `attempt_count` (which the reaper can advance without an execution).
It is incremented by `contracts_operationalization_segment_start` each time an execution
legitimately begins, and the value in force is stored on the segment row as
`current_staging_generation`. The executing handler carries it in memory for the duration of
the call.

**Order of operations — nothing is persisted until everything has passed.** An attempt
writes staging only after the complete, in-memory pipeline succeeds:

```
provider completion (clean stop reason — §7.1.1)
  → JSON parse
  → transport reconstruction (normalizeCompactContractOperationalization)
  → page provenance validation + local→global remap (§6.3)
  → evidence gate (assertOperationalEvidence)
  → [only now] ONE atomic persistence call
```

There is no incremental write, no "save what we have so far", no partial flush between
families. A crash at any point before the persistence call leaves **zero** staging rows for
that attempt — which is the correct state, because a partial reading is not a reading.

**Atomic supersession.** `contracts_operationalization_segment_settle` performs, in **one
transaction**:

1. `SELECT … FOR UPDATE` the segment row;
2. abort (returning `stale_generation`) unless the caller's `staging_generation` equals
   `segment.current_staging_generation` — a worker whose lease was reaped and whose work was
   superseded by a newer attempt **writes nothing**;
3. mark every existing staging row of that segment with a lower generation
   `consolidation_state = 'SUPERSEDED'` (retained for forensics, invisible to consolidation);
4. insert the new attempt's rows at the current generation;
5. set the segment terminal (`SUCCEEDED`), stamp provenance and usage;
6. recount the run and conditionally enqueue finalize (§8.4).

Superseded rows are **retained, not deleted** — deleting them would destroy the record of
what a failed or replaced attempt actually read, and this codebase does not delete
provenance. They are simply not authoritative.

**What consolidation reads.** Exactly:

```
staging rows
WHERE segment.status = 'SUCCEEDED'
  AND staging_generation = segment.current_staging_generation
  AND consolidation_state NOT IN ('SUPERSEDED','OVERLAP_NOT_OWNED')
```

One generation per segment, by construction. Enforced additionally by a partial unique index
(§18.3) so that two authoritative generations for one segment cannot exist even if the
application tried.

**Failed attempts write no staging at all.** A `FAILED` segment contributes nothing:
truncation (§7.1.1), transport corruption, provenance violation and evidence-gate emptiness
all fail before the persistence call. Only `SUCCEEDED` segments have authoritative rows.

### 8.3 `contracts.contract_operationalization.finalize`

```ts
{ run_id: uuid, contract_id: uuid, document_id: uuid,
  requested_by: uuid.nullable(), operationalization_version: string }
```

- **Idempotency key:** `contract-operationalization-finalize:{run_id}`
  One finalize per run, forever. Two racing segment completions both trying to enqueue it
  converge on the same row via `aj_idempotent` + `ON CONFLICT DO NOTHING`.
- **`max_attempts`: 3.** No provider call; deterministic consolidation plus one transaction.
- **Becomes runnable** by two independent paths (§8.4).
- **Failure:** transaction rejection → retryable until attempts exhausted → run `FAILED`
  (never a partial canonical write, because the transaction is all-or-nothing).

### 8.4 How the next stage becomes runnable — and why there is no deadlock

**Primary (fast):** at the end of a segment handler, in the *same* statement that marks the
segment terminal, an RPC (`contracts_operationalization_segment_settle`) locks the run row,
recounts terminal segments, and — only if the count now equals the required count — enqueues
the finalize job and moves the run to `CONSOLIDATING`. Lock-then-count-then-enqueue in one
transaction means two segments finishing simultaneously cannot both enqueue, and neither can
miss.

**Safety net (durable):** a new entry in `SCHEDULED_PRODUCERS`
(`src/lib/platform/jobs/producers.ts`) sweeps, every drain pass, for runs where
`status IN ('PROCESSING','CONSOLIDATING')` and every segment is terminal and no finalize job
exists, and enqueues it. This is what makes a deadlock impossible: the fast path can be lost
(process killed between the provider response and the settle call) without the run stalling,
because the sweep decides from **durable state**, not from an in-flight promise — the same
reasoning migration 168 uses for `contracts_reconcile_orphaned_executions`.

The same sweep also reconciles orphaned segments (§11.2).

---

## 9. Consolidation — deterministic first, no AI

Input: the **authoritative generation** of every `SUCCEEDED` segment of the run — exactly
one reading per segment, per §8.2.1:

```
staging rows
WHERE run_id = :run
  AND segment.status = 'SUCCEEDED'
  AND staging_generation = segment.current_staging_generation
  AND consolidation_state NOT IN ('SUPERSEDED','OVERLAP_NOT_OWNED')
```

Output: a canonical candidate set. Pure function over those rows; no network, no model,
unit-testable. Consolidation never sees a superseded attempt, a failed attempt, or a
partially-persisted one — none of those exist as authoritative rows.

### 9.1 Rule 1 — page ownership (structural, primary)

Every page of the document is **owned by exactly one segment** (§4). A staging item is a
consolidation candidate **only if its global `source_page` lies in its own segment's owned
range**. An item read from an overlap page that belongs to the previous segment is retained
in staging, marked `overlap_not_owned`, and never materialized.

This makes the ordinary overlap duplicate — the same clause on the same page read twice —
**impossible by construction**, without comparing text at all. It is not a heuristic; it is
a partition.

### 9.2 Rule 2 — exact evidence identity

Within the candidate set, two items are the same item iff

```
family == family  AND  operationalFingerprint(family, source_page, source_excerpt) equal
```

i.e. identical family, identical global page, identical trimmed excerpt. Collapse them.
This is the same identity the system already uses for re-analysis idempotency, so
consolidation and re-run idempotency agree by construction.

### 9.3 Rule 3 — boundary containment (evidence-based, narrow)

The residual case: a clause spanning a page break is cited at page *p* by the owning
segment and at page *p+1* by the next. Different pages → different fingerprints → two
canonical items.

Restricted collapse, applied **only** to pairs where all of the following hold:

- same `family`;
- the two items come from **adjacent** segments;
- `|page_a − page_b| <= SEGMENT_OVERLAP`;
- both pages lie inside the shared overlap band of those two segments;
- after a comparison-only normalization (casefold, collapse runs of whitespace, strip
  punctuation-only edges) **one excerpt contains the other**.

Then: collapse, keeping the **longer** excerpt and the **lower** page, with the union of
contributing provenance. Stored evidence is the original, unnormalized excerpt — the
normalization exists only to decide the question.

If containment does **not** hold, the two items are **kept separate**. Two materially
different requirements are what the contract says; silently merging them would delete a
requirement. Titles are never compared, and title equality is never grounds for merging —
"Seguro de responsabilidade civil" can legitimately name three different obligations.

### 9.4 Confidence of a collapsed item

`confidence = MIN(contributing confidences)`. Never mean, never max. An average could lift
a 0.6 reading over the 0.75 authority gate by pairing it with a 0.9 reading of the same
text; `MIN` cannot fabricate confidence in either direction.

`ambiguous` / `conflicting` flags are OR-ed (any contributor's doubt survives the merge).

### 9.5 Deterministic ordering

Candidates are sorted by `(family, source_page, source_excerpt)` before writing, so two
runs over the same staging produce byte-identical output and diffs are reviewable.

---

## 10. Canonical materialization — idempotent and transactional

Finalize does all AI-free work in the app (consolidation is pure), then performs **one RPC**,
`contracts_operationalization_materialize(p_run_id, p_items jsonb, p_analysis_id, …)`, whose
body is a single transaction:

1. `SELECT … FOR UPDATE` the run; abort unless `status IN ('CONSOLIDATING','MATERIALIZING')`.
2. Set run `MATERIALIZING`.
3. Set the **parent** analysis to `running` (§11.1) with `execution_job_id` = the finalize job.
4. Insert **every** consolidated item into `contract_operational_interpretations`
   (`ON CONFLICT (analysis_id, family, fingerprint) DO NOTHING` — the existing
   `copi_analysis_fact_unique`). Every reading is retained, governed or not.
5. Apply the trust gate result: only `trust_state = 'automatic'` items proceed.
6. Insert into the five canonical tables with `ON CONFLICT DO NOTHING` against the existing
   partial unique indexes from migration 160
   (`(organization_id, contract_id, source_document_id, ai_fingerprint) WHERE ai_origin='apex_ai'`).
   **These indexes are the real guarantee**; the application-level fingerprint skip is the
   second barrier, not the first.
7. For each inserted obligation definition, call `contract_obligations_materialize(...)`
   **in the same transaction** (plpgsql can, the application cannot) with a 2-year horizon.
   This is what makes "a crash halfway through materialization" impossible to observe: the
   obligation instances either exist with their definitions or neither exists.
8. Count `AWAITING_SCHEDULE_ANCHOR` instances.
9. Set the parent analysis `completed` with counts, usage totals, rejections, attention list.
10. Set the run `COMPLETED`, `completed_at = now()`.

Any failure → the whole transaction rolls back → run returns to `CONSOLIDATING` → the
finalize job retries → step 4–7 re-run and every insert is a no-op on the conflict indexes.
**Finalize twice is a no-op the second time. A crash halfway leaves nothing.**

Note the two barriers that already exist and are preserved: the `*_ai_evidence_check`
CHECK (page/document must match the stored evidence object) and
`contracts_guard_ai_operational_authority()` (a script cannot bypass the confidence /
material-exposure gate). Both keep working unchanged, because the rows we insert have the
same shape as today's.

---

## 11. Provenance

### 11.1 One user-facing analysis, N technical children

- **Parent:** one row in `contract_ai_analyses`, `extracted_data.kind = 'contract_operationalization'`,
  `extractor_version = 'contract-operationalization/2.0.0'`, `document_id` set. Created at
  PLANNING with `status = 'pending'` and **`execution_job_id = NULL`**. Promoted to
  `running` only inside the materialization transaction, then `completed`.
  This is what the product shows. **Exactly one per run.**
- **Children:** one row per segment, `extracted_data.kind = 'contract_operationalization_segment'`,
  `extracted_data.parent_analysis_id`, `segment_index`, `page_start`, `page_end`,
  `execution_job_id` = the segment job, `status` running → completed/failed. Never surfaced
  as a user-facing analysis; queries that list analyses for a contract filter on
  `kind = 'contract_operationalization'`.

**Why the parent starts `pending` with a NULL job — the migration-168 interaction.**
`contracts_reconcile_orphaned_executions()` marks `failed` every analysis with
`status='running'` whose `execution_job_id` job is not `PROCESSING` with a live lease. A
parent held `running` across a multi-minute, multi-job run — while its plan job is already
`COMPLETED` — would be reconciled to `failed` on the very next drain pass, killing every run
in flight. Two properties avoid this without touching 168: `pending` is not in its
`WHERE`, and its `JOIN apex_jobs ON j.id = a.execution_job_id` drops NULL rows anyway.
The parent is only `running` inside a single transaction that also holds its job's lease.
**Child analyses get 168's recovery for free**, exactly as intended, because each one is
`running` under exactly one live segment job.

### 11.2 Segment reconciliation (new, additive)

`contracts_reconcile_operationalization_runs(p_limit)` — a new function called from the same
sweep as §8.4, deliberately **separate** from 168's function so neither depends on the
other's success:

- segment `RUNNING` whose job is `PENDING` → segment back to `PENDING` (it will re-run);
- segment `RUNNING` whose job is `DEAD_LETTER`/`CANCELLED` → segment `FAILED`, with
  `error_code='worker_execution_terminated'`;
- run `PLANNING` whose plan job is `DEAD_LETTER` → run `FAILED`;
- run non-terminal with all segments terminal → hand to §8.4.

It asserts nothing it cannot prove. It never writes `human_action`, never invents a
provider outcome, and records `provider_response_state: 'unknown'` where the truth is
unknowable — the wording migration 168 already established.

### 11.3 Traceability chain

Every canonical item traces to:

```
canonical row
  ├─ source_document_id + source_page + ai_evidence.excerpt   (documentary truth)
  ├─ ai_analysis_id                → parent analysis          (the ONE run-level analysis)
  └─ interpretation row (same fingerprint)
        ├─ staging item(s)          → segment_id              (which slice read it)
        │                           → segment.analysis_id     (child technical analysis)
        │                           → segment.execution_job_id(which job invocation)
        └─ run_id                                             (the operationalization run)
```

Nothing in the chain is reconstructed by inference. Every hop is a stored foreign key.

---

## 12. Authority (unchanged principles)

> Truth deterministic. Intelligence probabilistic. Authority governed. Actions auditable. Autonomy earned.

- The signed PDF remains documentary truth. Segmentation changes **how** it is read, never
  **what** it is.
- Every staging, interpretation and canonical row carries page + literal excerpt. The
  existing evidence gate runs per segment; nothing without evidence reaches staging.
- `evaluateOperationalTrust` is applied **once, at consolidation, to the consolidated item**
  — not per segment. A collapsed item is evaluated on its final confidence (`MIN`) and its
  final amounts. Low confidence and material financial exposure continue to route to
  `requires_attention` under the migration-154 attention policy; those readings are retained
  in `contract_operational_interpretations` and **never** copied into an authority-bearing
  table.
- Nothing in this pipeline fabricates human review, validation, acceptance, assignment,
  confidence, or evidence. No run state, segment state, or reconciliation writes a human
  actor. `requested_by` is the real uploader, propagated from the durable request.
- Ambiguous / conflicting / low-confidence readings stay governed. Items that consolidation
  could not prove identical stay separate rather than being silently merged — refusing to
  merge is the conservative direction here, because merging deletes a requirement while
  keeping both at worst duplicates one, visibly.

**Blocking constraint to respect at implementation time:** migration 160's
`*_ai_evidence_check` requires `ai_requesting_user_id IS NOT NULL` for every
`ai_origin='apex_ai'` canonical row. A fully automatic run must therefore carry a non-null
`requested_by` all the way from the onboarding finalize through the run, the segments, and
into materialization. If `requested_by` is ever null the entire materialization transaction
is rejected by the database — correctly, but late. Planning must refuse to start a run with
a null `requested_by` and fail visibly at PLANNING instead.

---

## 13. Queue, orchestration and continuation (no Vercel Pro)

### 13.1 Automatic start — and where the long job is NOT allowed to run — P0

```
USER ROUTE (upload / onboarding finalize / amendment / re-analysis)
  │
  ├─ commits the durable work            ← the only thing that must succeed
  ├─ responds to the user
  └─ after(): best-effort WAKE only      ← one authenticated HTTP POST, nothing more
        │
        └─▶ POST /api/platform/jobs/drain   ← a NEW invocation, its OWN host lifetime
                └─▶ drainOnce() executes the queue, including segment AI handlers
```

**The required change.** `scheduleFastDrain` today calls `drainOnce` **directly inside
`after()`**, i.e. inside the user's own upload/onboarding invocation
(`src/lib/platform/jobs/fast-path.ts`). That is acceptable for the short handlers it was
written for and **is not acceptable for `CONTRACT_OPERATIONALIZATION_SEGMENT`**, for one
reason that no amount of budget tuning fixes:

> The user route's remaining host lifetime at the moment `after()` begins is **unknown**.

It is not a fresh 300s. The upload already spent time on auth, RLS reads, a storage write,
an RPC and response serialization — and on a large PDF that time is neither small nor
predictable. `drainOnce` would then start its clock at zero against a lifetime that is
already partly consumed, admit a 150s segment job on the strength of a budget it does not
actually have, and be killed mid-provider-call. The result is the exact failure mode of the
original incident, reintroduced through a different door: a job whose attempt is already
consumed, a lease held to expiry, a child analysis stuck `running`, and no diagnostic —
because the process that would write the diagnostic is the one that ceased to exist.

**Therefore, normatively:**

1. `scheduleFastDrain` becomes `scheduleDrainWake` and does exactly one thing inside
   `after()`: issue a single fire-and-forget `POST` to
   `${APEX_SITE_URL}/api/platform/jobs/drain` with
   `Authorization: Bearer ${APEX_JOBS_SECRET}` and a short client-side timeout (~2s). It
   does not await the drain, does not read the response body beyond the status, and never
   propagates failure into the user's request — which has already responded.
2. **No long AI handler may ever execute inside a user-route invocation.** The dedicated
   drain route is the only execution surface for the queue, and it declares
   `maxDuration = 300`, so every drain gets a lifetime it can actually measure from zero.
3. The wake carries **no authority of its own**. `authorizePlatformCron` is unchanged and
   mandatory: `Authorization: Bearer` matching `APEX_JOBS_SECRET` or `CRON_SECRET`, in
   constant time. `x-apex-trigger` is a **diagnostic label only** — forgeable, logged after
   the credential is validated, and never consulted in an authorization decision. This is
   already the module's documented position; the wake must not erode it.
4. **Correctness never depends on the wake.** If `APEX_SITE_URL` or `APEX_JOBS_SECRET` is
   absent, if the POST is refused, if the platform drops the `after()` task, if the network
   fails — the job is already `PENDING` and durable, and the next GitHub Actions heartbeat
   runs it. The wake is a latency optimizer, exactly as the current module's doc comment
   says; the only change is that it now optimizes latency **by waking the right process**
   instead of by borrowing the wrong one's lifetime.
5. Under `isDrainPaused()` no wake is even issued (unchanged short-circuit), and the drain
   route's own hold guard remains the authoritative one.

**What does not change:** the user path itself. Upload → durable request → clause extraction
job → plan job → segments → finalize, with **no user click between any two stages**.

### 13.2 Admission: claim ONE job at a time — P0

`drainOnce` today claims in batches of up to 5 and then executes them **sequentially,
without re-checking any budget between them**:

```ts
const batchSize = Math.min(5, limits.maxJobs - executed);
…
for (const job of jobs) { await executeJob(job, …) }   // ← no budget check per job
```

The defect is in *when the lease is taken*. `apex_jobs_claim` sets `PROCESSING`, stamps
`lease_expires_at`, and **increments `attempt_count`** for all 5 rows at once — at a moment
when 4 of them will not begin executing for minutes. With 14 segment jobs pending, one claim
takes 5 and runs them back to back: 5 × 150s = 750s inside a 300s function. The host kills
the invocation; jobs 3–5 were charged an attempt they never spent; their leases hang until
reaped; the run limps. **Leasing work that cannot begin is the bug, not running it slowly.**

**Required V2 worker admission behaviour:**

1. **Claim exactly one job per claim call.** `p_limit = 1`. No batch, ever, while any long
   job class can appear in the queue — and since the queue is shared, that means always.
2. **Re-evaluate the host budget immediately before every claim**, against the clock, using
   the hard admission rule of §7.2:
   ```
   if (hostRemainingMs() <= worstCaseMsFor(MAX_JOB_CLASS) + CLAIM_OVERHEAD_MS) stop claiming
   ```
   Because the worker cannot know a job's type until after it has claimed it, admission uses
   the **most expensive job class currently registered** (`MAX_JOB_CLASS`, today the legacy
   monolith's 225s) as the conservative bound. Admitting on an optimistic guess and
   discovering a long job afterwards is exactly the lease-first-ask-later mistake, one level
   up.
3. **Never lease a job that cannot safely begin.** The check precedes the claim; there is no
   window in which a row is `PROCESSING` for a worker that has already decided it has no
   time. Stopping early with work still queued is the **correct** outcome — what remains is
   durable, and the next invocation continues (this is `worker.ts`'s existing doctrine, now
   enforced per job instead of per batch).
4. **Preserve `SKIP LOCKED` concurrency across invocations.** `apex_jobs_claim` keeps its
   `UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED)` shape unchanged. Two concurrent drains
   (Actions + a wake + an operator) still receive **disjoint** single jobs and neither waits
   on the other. Reducing `p_limit` to 1 narrows how much one worker takes, not how many
   workers may run.
5. **No fake parallelism inside one invocation.** No `Promise.all` over jobs, no worker
   pool, no concurrent provider calls. One serverless invocation executes at most one long
   job at a time, sequentially. Real parallelism comes from independent invocations —
   multiple Actions runs, the wake, the cron — which is where `SKIP LOCKED` already provides
   it safely. Overlapping two 150s provider calls inside one 300s lifetime would consume the
   lifetime twice over while making the failure mode harder to read.
6. **Post-claim re-check (defence in depth).** After claiming, the worker knows the real job
   type. If `hostRemainingMs() <= worstCaseMsFor(job.job_type)`, it does **not** execute:
   it releases the job (§13.2.1) and stops the pass. This closes the gap where a claim was
   admitted under the conservative bound but the round trip itself consumed the margin.

#### 13.2.1 `apex_jobs_release` — required, not optional

Promoted from "optional hardening" to a **required** part of migration 169, because rule 6
depends on it.

```
apex_jobs_release(p_job_id uuid, p_lock_token uuid) RETURNS boolean
```

Returns a claimed-but-unexecuted job to `PENDING`, clears the lease, **and decrements
`attempt_count`** — the attempt was never spent, and charging for it would walk a job toward
`DEAD_LETTER` for a scheduling decision rather than a failure. Requires the current
`lock_token` (same discipline as `apex_jobs_complete`/`apex_jobs_fail`), returns `false`
rather than raising when the lease was lost, and clamps `attempt_count` at 0.

Without it, a worker that admits then thinks better of it must hold the lease to expiry:
5 minutes of invisibility, plus an attempt burned, for a job that never ran.

### 13.3 Continuation: no self-chaining in V1

A 14-segment run at ~1 segment per pass takes ~140 minutes on a `*/10` cadence. The V1
answer is **two mechanisms, both already in the repository**:

1. **Immediate best-effort wake after every durable enqueue** (§13.1). The plan job, each
   segment's settle, and the finalize enqueue each issue one wake to the dedicated drain
   route. In practice this is what makes a run progress in minutes rather than in cron
   intervals: each completed segment wakes the next pass.
2. **GitHub Actions as the durable continuation and recovery plane.**
   `.github/workflows/apex-jobs.yml` already exists, already authenticates with
   `APEX_JOBS_SECRET` via `Authorization: Bearer`, already uses
   `concurrency: apex-jobs-drain` with `cancel-in-progress: false`, and is already
   documented as *a scheduler, not the truth of the system*. **Change the schedule from
   `*/10` to `*/5`** — but only after implementation validation confirms the cadence is
   actually honoured for this repository (GitHub throttles and coalesces scheduled workflow
   runs under load; a cron that is *declared* every 5 minutes is not always *run* every 5
   minutes). If validation does not confirm it, `*/10` stays and the wake carries the
   latency. Correctness is identical either way.

**Self-continuation (`x-apex-continuation` depth chaining) is NOT part of V1.** It was
proposed to close a latency gap that mechanism 1 already closes, and it costs a recursive
HTTP call pattern with a depth counter, a runaway-cost failure mode, and an authorization
surface that must be re-argued every time someone touches the drain route. There is no
proven need. It is recorded in §22.1 as deferred, to be reconsidered only if measured
end-to-end run time on a real 195-page contract is unacceptable **and** the wake is
demonstrably not the cause.

What remains authoritative for correctness, in both mechanisms and in their absence:
**durable jobs + `aj_idempotent` + `SKIP LOCKED` + the reap/reconcile plane.** No schedule,
no wake, and no header participates in correctness.

`vercel.json`'s daily `0 6 * * *` cron stays untouched (Hobby allows only daily; declaring
finer there would fail or silently not run — the existing comment is correct).

**Vercel Pro is not required by anything in this design.**

### 13.4 Operational hold

`isDrainPaused()` (`APEX_JOBS_DRAIN_PAUSED`) remains the single authoritative guard in
`drainOnce`. Under hold: no plan, no segment, no finalize, **no provider call**, no state
change — and no wake is even issued (§13.1). Runs freeze exactly where they are and resume
when the flag leaves the environment. Nothing in this pipeline depends on a human draining
the queue by hand; a manual drain is a convenience, never a step.

---

## 14. UX

The onboarding/dossier progress experience shows, derived from the **run status only**:

| Run state | User-visible |
|---|---|
| (request queued / running) | `Documento recebido` |
| clause extraction completed | `Estruturação concluída` |
| `PLANNING`, `PROCESSING` | `Operacionalização em andamento` |
| `CONSOLIDATING`, `MATERIALIZING` | `Consolidação` |
| `COMPLETED` | `Concluído` |
| `PARTIALLY_FAILED`, `FAILED` | `Precisa de atenção` (with the safe error text) |
| `FAILED` with `error_code='document_too_large'` | `Documento não suportado nesta versão` — a distinct label, because "retry" is not the remedy (§5.2) |
| `CANCELLED` | `Cancelado` |

Optional progress percentage: `terminal_segments / required_segments`, clamped to 95% until
the run is `COMPLETED` — a bar that reads 100% while the contract is not yet operationalized
is a lie with a progress bar on it.

Forbidden in the UI: segment lists, page ranges, chunk counts, per-segment retry buttons,
segment errors as workflow tasks. A support/admin diagnostic view may show them; the
ordinary user's contract screen may not.

---

## 15. Reanalysis and cache reuse

```
document_sha256    = sha256(exact PDF bytes downloaded at PLANNING)
segment_fingerprint = sha256(
    document_sha256 ‖ segmentation_version ‖ operationalization_version ‖
    segment_task_prompt_version ‖ model ‖ segment_index ‖ page_start ‖ page_end ‖ overlap_before)
```

A new run may mark a segment `SKIPPED_REUSED` and copy the previous run's staging rows
**only if every one of these holds**:

- same `organization_id`, `contract_id`, `source_document_id`;
- identical `segment_fingerprint`;
- the donor segment is `SUCCEEDED` and belongs to a run that is not `CANCELLED`;
- the donor segment's `invalidated_at IS NULL`.

Any change to the document bytes changes `document_sha256`, which changes every segment
fingerprint, which makes reuse impossible — **reuse across a changed document version
cannot happen by omission, only by proof.** Same for a bumped segmentation version, a bumped
operationalization version, a changed prompt version, or a changed model.

Reuse is **off by default in phase 1** (`APEX_OPERATIONALIZATION_SEGMENT_REUSE=false`) and
enabled only after the first real run's numbers are known. Copied staging rows record
`reused_from_segment_id` so provenance never claims a call that did not happen.

---

## 16. Amendments (design-only, not implemented)

No amendment-diff processing is built here. What this design deliberately provides for it:

- Segment identity is a **page range over a hashed document**. An amendment impact analysis
  that can say "this amendment touches clauses on pages 88–104 of the original" maps that
  interval onto `[page_start, page_end]` and gets the exact set of affected segments.
- `invalidated_at` / `invalidation_reason` exist on the segment row from day one, so
  selective invalidation is an `UPDATE` on a handful of rows plus a new run that reuses the
  untouched segments and re-executes only the invalidated ones.
- Because reuse is fingerprint-proven, a partially invalidated re-run cannot accidentally
  reuse an affected region.

Nothing in V1 writes those columns.

---

## 17. Backward compatibility

- `contracts.contract_operationalization.execute` stays registered in `JOB_TYPES`,
  `JOB_SCHEMAS` and `JOB_HANDLERS`. Removing it would make `isJobType()` reject historical
  rows and turn readable history into `unknown_job_type`.
- Its handler gains one guard at the top: if a `COMPLETED` V2 run exists for the same
  `(organization_id, contract_id, document_id)`, return `{skipped: true, superseded_by_run: …}`
  without calling the provider. Re-delivery of a legacy job must not re-read a 195-page
  contract.
- Historical analyses with `extractor_version = 'contract-operationalization/1.0.0'` remain
  readable and are never rewritten, superseded-flagged, or deleted. Historical
  interpretations, rejections and canonical facts keep their provenance exactly as recorded.
- `contracts_recover_legacy_extraction_job()` (migration 168) keeps working; the only change
  is that at implementation time its enqueue target becomes the **plan** job. Its dry-run
  default and its explicit approved-orphan list stay.
- New runs are always V2. There is no per-request toggle between monolith and segments;
  the transition is by deploy, gated by one feature flag (§19).

### 17.1 A trap to preserve exactly as-is

`operationalFingerprint` is called with **plural** family names when writing
`contract_operational_interpretations` (`'obligations'`) and **singular** ones when writing
canonical facts (`'obligation'`, via `KIND_TO_REJECTION_FAMILY`). The same item therefore
has two different fingerprints in the two tables. That is today's behaviour and both unique
indexes depend on it. V2 must reproduce it **exactly**; "fixing" it would orphan every
existing row's idempotency and cause duplicate canonical facts on the next run of any
already-operationalized contract. Consolidation (§9.2) uses the **canonical/singular**
convention internally and converts at the interpretation-write boundary, as today.

---

## 18. Database migration design (migration 169 — NOT created in this task)

Production tip is **168**. Propose **169** only if no newer migration exists at
implementation time; otherwise take the next free number and keep the content identical.

### 18.1 `contract_operationalization_runs`

```
id                      uuid PK
organization_id         uuid NOT NULL → organizations(id) ON DELETE CASCADE
contract_id             uuid NOT NULL
source_document_id      uuid NOT NULL
request_id              uuid            -- the durable clause-extraction request that caused it
parent_analysis_id      uuid NOT NULL   -- the ONE user-facing analysis
status                  text NOT NULL CHECK (status IN
                          ('PLANNING','PROCESSING','CONSOLIDATING','MATERIALIZING',
                           'COMPLETED','PARTIALLY_FAILED','FAILED','CANCELLED'))
document_sha256         text NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$')
page_count              integer NOT NULL CHECK (page_count > 0)
page_count_heuristic    integer
segment_pages           integer NOT NULL CHECK (segment_pages > 0)
segment_overlap         integer NOT NULL CHECK (segment_overlap >= 0 AND segment_overlap < segment_pages)
segmentation_version    text NOT NULL
operationalization_version text NOT NULL
required_segments       integer NOT NULL CHECK (required_segments > 0)
requested_by            uuid NOT NULL → auth.users(id) ON DELETE RESTRICT   -- §12 blocking constraint
plan_job_id             uuid
finalize_job_id         uuid
recovery_generation     integer NOT NULL DEFAULT 0
error_code              text CHECK (error_code IS NULL OR error_code IN (
                          'document_too_large','document_unreadable','document_empty',
                          'requester_missing','segments_failed','materialization_rejected',
                          'worker_execution_terminated','cancelled_by_operator'))
error_safe              text
counts                  jsonb NOT NULL DEFAULT '{}'  CHECK (jsonb_typeof(counts) = 'object')
created_at, started_at, consolidated_at, completed_at  timestamptz

CONSTRAINT cor_org_id_unique   UNIQUE (organization_id, id)
CONSTRAINT cor_contract_tenant FK (organization_id, contract_id) → contracts (organization_id, id) ON DELETE CASCADE
CONSTRAINT cor_document_tenant FK (organization_id, contract_id, source_document_id)
                               → contract_documents (organization_id, contract_id, id) ON DELETE CASCADE
CONSTRAINT cor_analysis_tenant FK (organization_id, parent_analysis_id)
                               → contract_ai_analyses (organization_id, id) ON DELETE RESTRICT
CONSTRAINT cor_plan_job_tenant     FK (organization_id, plan_job_id)     → apex_jobs (organization_id, id) ON DELETE SET NULL
CONSTRAINT cor_finalize_job_tenant FK (organization_id, finalize_job_id) → apex_jobs (organization_id, id) ON DELETE SET NULL
CONSTRAINT cor_terminal_coherent CHECK (
  (status IN ('COMPLETED','PARTIALLY_FAILED','FAILED','CANCELLED')) = (completed_at IS NOT NULL))
```

Indexes:

```
CREATE UNIQUE INDEX cor_one_open_run ON contract_operationalization_runs
  (organization_id, contract_id, source_document_id)
  WHERE status NOT IN ('COMPLETED','PARTIALLY_FAILED','FAILED','CANCELLED');

CREATE UNIQUE INDEX cor_one_completed_reading ON contract_operationalization_runs
  (organization_id, contract_id, source_document_id, document_sha256,
   operationalization_version, segmentation_version)
  WHERE status = 'COMPLETED';

CREATE INDEX cor_open ON contract_operationalization_runs (organization_id, status, created_at)
  WHERE status NOT IN ('COMPLETED','PARTIALLY_FAILED','FAILED','CANCELLED');
```

Transition trigger: `BEFORE UPDATE` rejecting any `(OLD.status → NEW.status)` outside §3.2
and any change at all when `OLD.status` is terminal.

### 18.2 `contract_operationalization_segments`

```
id                   uuid PK
organization_id      uuid NOT NULL → organizations(id) ON DELETE CASCADE
run_id               uuid NOT NULL
contract_id          uuid NOT NULL
source_document_id   uuid NOT NULL
segment_index        integer NOT NULL CHECK (segment_index >= 0)
page_start           integer NOT NULL CHECK (page_start >= 1)
page_end             integer NOT NULL CHECK (page_end >= page_start)
overlap_before       integer NOT NULL CHECK (overlap_before >= 0)
owned_page_start     integer GENERATED ALWAYS AS (page_start + overlap_before) STORED
owned_page_end       integer GENERATED ALWAYS AS (page_end) STORED
segment_fingerprint  text NOT NULL CHECK (segment_fingerprint ~ '^[0-9a-f]{64}$')
status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN
                       ('PENDING','RUNNING','SUCCEEDED','FAILED','SKIPPED_REUSED','CANCELLED'))
execution_job_id     uuid
analysis_id          uuid
reused_from_segment_id uuid
recovery_generation  integer NOT NULL DEFAULT 0   -- deliberate recoveries only (§8.2)
current_staging_generation integer NOT NULL DEFAULT 0 CHECK (current_staging_generation >= 0)
                                                  -- the authoritative attempt (§8.2.1)
rejected_payload     jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rejected_payload) = 'array')
provider, model      text
input_tokens, output_tokens, duration_ms  integer
stop_reason          text
error_code, error_safe text
invalidated_at       timestamptz
invalidation_reason  text
created_at, started_at, completed_at timestamptz

CONSTRAINT cos_org_id_unique  UNIQUE (organization_id, id)
CONSTRAINT cos_run_index      UNIQUE (run_id, segment_index)
CONSTRAINT cos_run_tenant     FK (organization_id, run_id) → contract_operationalization_runs (organization_id, id) ON DELETE CASCADE
CONSTRAINT cos_document_tenant FK (organization_id, contract_id, source_document_id)
                              → contract_documents (organization_id, contract_id, id) ON DELETE CASCADE
CONSTRAINT cos_job_tenant     FK (organization_id, execution_job_id) → apex_jobs (organization_id, id) ON DELETE SET NULL
CONSTRAINT cos_analysis_tenant FK (organization_id, analysis_id) → contract_ai_analyses (organization_id, id) ON DELETE SET NULL
CONSTRAINT cos_owned_range    CHECK (owned_page_start <= owned_page_end)
CONSTRAINT cos_first_no_overlap CHECK (segment_index > 0 OR overlap_before = 0)
CONSTRAINT cos_terminal_coherent CHECK (
  (status IN ('SUCCEEDED','FAILED','SKIPPED_REUSED','CANCELLED')) = (completed_at IS NOT NULL))
CONSTRAINT cos_reuse_coherent CHECK (
  (status = 'SKIPPED_REUSED') = (reused_from_segment_id IS NOT NULL))
CONSTRAINT cos_rejected_small CHECK (pg_column_size(rejected_payload) <= 65536)

CREATE INDEX cos_pending ON contract_operationalization_segments (run_id, status);
CREATE INDEX cos_fingerprint_reuse ON contract_operationalization_segments
  (organization_id, source_document_id, segment_fingerprint)
  WHERE status = 'SUCCEEDED' AND invalidated_at IS NULL;
```

### 18.3 `contract_operationalization_staging_items`

```
id                  uuid PK
organization_id     uuid NOT NULL → organizations(id) ON DELETE CASCADE
run_id              uuid NOT NULL
segment_id          uuid NOT NULL
contract_id         uuid NOT NULL
source_document_id  uuid NOT NULL
family              text NOT NULL CHECK (family IN
                      ('obligations','billing_conditions','guarantees',
                       'insurance_requirements','indexation_rules'))
fingerprint         text NOT NULL              -- operationalFingerprint(canonical/singular family, global page, excerpt)
normalized_payload  jsonb NOT NULL CHECK (jsonb_typeof(normalized_payload) = 'object')
source_page         integer NOT NULL CHECK (source_page > 0)   -- GLOBAL, already remapped
segment_local_page  integer NOT NULL CHECK (segment_local_page > 0)
source_excerpt      text NOT NULL CHECK (btrim(source_excerpt) <> '')
confidence          numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
ambiguous, conflicting boolean NOT NULL DEFAULT false
owned               boolean NOT NULL           -- source_page within this segment's owned range
consolidation_state text NOT NULL DEFAULT 'PENDING' CHECK (consolidation_state IN
                      ('PENDING','ACCEPTED','COLLAPSED','OVERLAP_NOT_OWNED','SUPERSEDED'))
collapsed_into_fingerprint text
staging_generation  integer NOT NULL CHECK (staging_generation >= 0)   -- §8.2.1
reused_from_segment_id uuid
created_at          timestamptz NOT NULL DEFAULT now()

CONSTRAINT cosi_org_id_unique UNIQUE (organization_id, id)
CONSTRAINT cosi_segment_fact_unique UNIQUE (segment_id, staging_generation, family, fingerprint)
CONSTRAINT cosi_run_tenant     FK (organization_id, run_id) → contract_operationalization_runs (organization_id, id) ON DELETE CASCADE
CONSTRAINT cosi_segment_tenant FK (organization_id, segment_id) → contract_operationalization_segments (organization_id, id) ON DELETE CASCADE
CONSTRAINT cosi_page_in_segment CHECK (true)   -- enforced by trigger against the segment's range
CONSTRAINT cosi_owned_coherent  CHECK (NOT owned OR consolidation_state <> 'OVERLAP_NOT_OWNED')
```

`cosi_segment_fact_unique` is the **duplicate-segment-execution guard**: a re-delivered
segment job writing the same items twice, within the same generation, conflicts on insert
instead of doubling staging.

Generation authority is enforced by the database, not only by the settle RPC:

```
-- At most ONE authoritative generation per segment. A second live generation cannot exist.
CREATE UNIQUE INDEX cosi_one_live_generation ON contract_operationalization_staging_items
  (segment_id, staging_generation)
  WHERE consolidation_state <> 'SUPERSEDED';
```

…backed by a `BEFORE INSERT` trigger that rejects any row whose `staging_generation` is not
the segment's `current_staging_generation`. A worker holding a stale generation — reaped
lease, superseded attempt — cannot write at all, even if the settle RPC were bypassed.

A `BEFORE INSERT` trigger enforces `segment.page_start <= source_page <= segment.page_end`
and `source_page = segment.page_start + segment_local_page - 1`. Page provenance is checked
by the database, not only by the normalizer.

### 18.4 RLS and grants (all three tables, following migration 161's pattern)

```
ALTER TABLE … ENABLE ROW LEVEL SECURITY;
CREATE POLICY …_read ON … FOR SELECT TO authenticated
  USING (organization_id = public.current_user_organization_id());
GRANT SELECT ON … TO authenticated;
GRANT INSERT, UPDATE ON … TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON … FROM anon, authenticated;
```

No `authenticated` write path exists. Runs, segments and staging are written only by the
worker under the service role, through the RPCs below.

### 18.5 Functions (all `SECURITY INVOKER`, `SET search_path = public, pg_temp`, revoked from `anon`/`authenticated`)

| Function | Purpose |
|---|---|
| `contracts_operationalization_plan(...)` | Create-or-find run + segments atomically; return the run and the segments to enqueue. |
| `contracts_operationalization_segment_start(p_segment_id, p_job_id, p_lock_token…)` | Claim a segment for this job; refuses if the run is terminal; **increments and returns `current_staging_generation`** (§8.2.1). |
| `contracts_operationalization_segment_settle(p_segment_id, p_staging_generation, p_status, p_items jsonb, …)` | Generation-checked, all-or-nothing: supersede older generations → insert this attempt → segment terminal → run counter → conditional finalize enqueue. Returns `stale_generation` and writes nothing if superseded (§8.2.1, §8.4). |
| `contracts_operationalization_materialize(p_run_id, p_items jsonb, …)` | The single materialization transaction (§10). |
| `contracts_reconcile_operationalization_runs(p_limit)` | Orphan recovery for runs/segments (§11.2). |
| `contracts_recover_operationalization_segment(p_segment_id, p_dry_run default true, …)` | Deliberate single-segment retry: bumps `recovery_generation`, resets to `PENDING`, enqueues one job. **Dry-run by default**, mirroring `contracts_recover_legacy_extraction_job`. |
| `contracts_cancel_operationalization_run(p_run_id, p_reason)` | Authorized cancellation before materialization. |
| `apex_jobs_release(p_job_id, p_lock_token)` | **Required** (§13.2.1): return an unexecuted claimed job to `PENDING`, clearing the lease and decrementing the attempt (clamped at 0). Lock-token guarded; returns `false` on a lost lease. |

`apex_jobs_release` is the **only** addition that touches the platform queue rather than the
contracts domain, and it is additive: a new function, no change to `apex_jobs`' shape,
constraints or existing functions. Everything else in migration 169 is new tables, new
functions and new indexes. No existing column, constraint, trigger or policy is modified,
which is what makes the deploy order in §19 safe.

---

## 19. Rollout

### 19.1 Phases

| Phase | Content | Ships with |
|---|---|---|
| **P0** | `pdf-lib` dependency; pure `planSegments()`; pure page-remap; pure consolidation function; unit tests for all three. No wiring. | code only |
| **P1** | Migration 169 (tables, RPCs, RLS). No code reads it yet. | migration only |
| **P2** | **P0 platform hardening, shippable on its own and valuable without segments:** claim-one-at-a-time + dynamic admission (§13.2), `apex_jobs_release`, the user-route wake replacing inline `drainOnce` (§13.1), per-job-class worst cases in `budget.ts`. | code |
| **P2b** | `CONTRACT_OPERATIONALIZATION_SEGMENT` task + policy + truncation fail-closed classifier (§7.1.1). | code |
| **P3** | Three job types, three handlers, generation-safe settle, the sweep wiring, the run reconciler in the drain pass. Flag **off**. | code |
| **P4** | Flag on for one organization; run JA10182283's acceptance test (§20). | config |
| **P5** | Flag on globally; legacy enqueue path removed (handler kept, §17). | config + code |
| **P6** | Optional: segment reuse (§15) enabled after real numbers exist. | config |

### 19.2 Migration and deploy order

The `budget.ts` doctrine applies verbatim: **migration before code.** 169 is additive, so
old code runs unchanged against the new schema; new code against a database without 169
would fail on the first write of a run row.

```
1. apply migration 169
2. deploy application code (flag OFF)
3. enable APEX_OPERATIONALIZATION_SEGMENTED for one organization
4. run the acceptance test
5. enable globally
```

`DEPLOY_BEFORE_MIGRATION_SAFE = false` stays false. Encode this order as a constant next to
`RELEASE_ORDER` so a test fails when someone reorders it.

### 19.3 Rollback

- **Before P5:** flip the flag off. New operationalizations go back through the monolithic
  path (which still exists and still works for small documents). Run rows already written
  are inert data; canonical rows already materialized stay valid and traceable. **No data
  migration, no deletion.**
- **After P5:** the flag still exists and the legacy handler still exists; flipping it off
  is the same one-step rollback.
- Migration 169 is never rolled back. Dropping it would delete provenance for runs that
  already produced canonical facts, and 160's `ON DELETE RESTRICT` would block it anyway.

### 19.4 Feature transition

One environment flag, `APEX_OPERATIONALIZATION_SEGMENTED`, read at the **enqueue** decision
point in the clause-extraction handler (strict `'true'` comparison, read per call, never
memoized in module scope — the `hold.ts` precedent). A document already in flight under the
monolithic path finishes under it; the flag only decides which job type the *next* enqueue
creates. No run ever switches modes mid-flight.

### 19.5 Observability

Structured logs, identifiers only, never payload (the `worker.ts` doctrine):

```
[apex-operationalization] { organization_id, run_id, segment_index, segment_id,
                            status, pages: "90-105", duration_ms, input_tokens,
                            output_tokens, stop_reason, accepted, rejected }
```

Run-level counters exposed by the drain response: `runs_planned`, `segments_executed`,
`segments_failed`, `runs_finalized`, `runs_partially_failed`, `segments_reconciled`.

Alert-worthy conditions (monitored, not auto-remediated): any run non-terminal for > 2h;
any segment with `stop_reason = 'max_tokens'`; a run whose `required_segments` exceeds 30;
total run input tokens > 1.5× the monolithic baseline.

### 19.6 Acceptance gates — test plan

Every item is a test that must exist and pass before P4. Grouped by the invariant it
defends; the P0 hardening items are marked.

**A — Segmentation and page provenance**

1. `planSegments()`: the owned-page partition is total, disjoint and order-preserving for
   1, 15, 16, 17, 32, 195 and 844 pages; `overlap_before = 0` only for index 0; the tail
   merge never leaves a segment owning zero pages.
2. Page remap: every local index outside `[1, segmentPageCount]` is **rejected, never
   clamped**; `global = page_start + local - 1` holds for every accepted item; a fabricated
   out-of-range global page cannot be constructed from any in-range local index.
3. **P0 — oversized documents fail closed (§5.2).** A page count implying
   > `MAX_SEGMENTS_PER_RUN` segments produces: run `FAILED`, `error_code='document_too_large'`,
   **zero** segment rows, **zero** jobs enqueued, **zero** provider calls, and — asserted
   explicitly — no page range is dropped, widened or truncated anywhere in the attempt.
4. Planning fails closed with its own distinct code for: unparseable/encrypted PDF,
   `page_count = 0`, and null `requested_by`.

**B — Worker admission (P0, §13.2)**

5. **Only one long job is claimed at a time.** With 14 segment jobs `PENDING`, a drain pass
   issues `apex_jobs_claim` with `p_limit = 1` and the number of rows moved to `PROCESSING`
   at any instant is never greater than 1.
6. **The second job is not leased until the worker is ready for it.** Assert on the job
   rows, not on the worker's internals: while job *k* is executing, job *k+1* is still
   `PENDING` with `attempt_count` unchanged and `lease_expires_at IS NULL`. This is the test
   that would have failed against today's batch of 5.
7. **Insufficient remaining host budget prevents the claim.** With the clock stubbed so that
   `hostRemainingMs() <= worstCaseMsFor(MAX_JOB_CLASS) + CLAIM_OVERHEAD_MS`, the pass makes
   **no** claim call at all, returns `stopped_early: true`, and every queued job is still
   `PENDING` with `attempt_count` unchanged.
8. **Post-claim re-check releases rather than executes.** When the budget evaporates between
   admission and dispatch, the job is returned via `apex_jobs_release`: status back to
   `PENDING`, lease cleared, `attempt_count` **decremented to its pre-claim value**, handler
   never invoked.
9. `apex_jobs_release` requires the current `lock_token`, returns `false` on a lost lease,
   and never drives `attempt_count` below 0.
10. **`SKIP LOCKED` concurrency is preserved.** Two concurrent `drainOnce` calls against the
    same queue receive **disjoint** jobs, neither blocks on the other, and no job is executed
    twice.
11. **No intra-invocation parallelism.** Static assertion that no drain path wraps job
    execution in `Promise.all`/`Promise.allSettled`, plus a runtime assertion that at most
    one provider call is in flight per invocation.
12. Budget wiring: `worstCaseMsFor()` is defined for every registered job type; no registered
    type has a worst case `>= APEX_CONFIGURED_HOST_CEILING`; the segment task's real
    `timeoutMs` from `getApexAITaskPolicy` matches `SEGMENT_PROVIDER_TIMEOUT_MS` (the
    `budget.ts` cross-check precedent).

**C — Dedicated long-job invocation (P0, §13.1)**

13. **The user-route fast path cannot directly execute a segment AI handler.** Invoking the
    wake from a simulated user route performs an outbound HTTP POST and **does not** call
    `drainOnce`, does not import the operationalization module, and makes no provider call.
    Asserted by spying on the gateway: zero `generate()` invocations from the user-route
    path, under any queue contents.
14. **The wake preserves authentication.** It sends `Authorization: Bearer <APEX_JOBS_SECRET>`;
    a wake without the header, or with a wrong secret, is rejected by
    `authorizePlatformCron` with 401 and drains nothing.
15. **Headers are diagnostic, never authorization.** A request bearing `x-apex-trigger`,
    `x-vercel-cron` or any `x-apex-continuation` value but **no valid Bearer token** is
    rejected. No header value can widen, substitute for, or bypass the credential check.
16. **A failed wake loses no durable work.** With `APEX_SITE_URL` unset, the secret missing,
    the POST returning 500, and the POST throwing — in each case the user request still
    succeeds, the job remains `PENDING` and durable, and a subsequent ordinary drain executes
    it to completion.
17. The wake is not issued at all under `isDrainPaused()`, and a drain that does arrive under
    hold changes no row.

**D — Truncation fails closed (P0, §7.1.1)**

18. **Token truncation never completes a segment.** A stubbed response with
    `stopReason = 'max_tokens'` — even one whose `items` parse perfectly — produces: segment
    **not** `SUCCEEDED`, **zero** staging rows, `error_code = 'segment_output_truncated'`, no
    finalize enqueued by that segment, no canonical write on any later path.
19. The stop-reason check is an **allow-list**: an unrecognized stop reason
    (`'refusal'`, `'pause_turn'`, `null`, `''`) fails the segment rather than passing.
20. Unparseable JSON, a root without `items`, and `items` that is not an array each fail the
    segment terminally and write no staging.
21. **`items: []` with a clean stop reason is a success with zero items** — segment
    `SUCCEEDED`, zero staging rows, and it counts toward the run's terminal segment total. A
    contract slice with no operational requirement must not be mistaken for a failure.
22. Truncation is classified retryable and transport corruption terminal, per the declared
    policy in `classifyJobError` — asserted against the classifier, not inferred from HTTP
    status.
23. No salvage: a truncated response containing 9 well-formed items persists **0**.

**E — Generation-safe staging (P0, §8.2.1)**

24. **A retry does not accumulate staging from an earlier generation.** Attempt 1 succeeds
    and writes N rows; attempt 2 (new generation) succeeds and writes M rows; consolidation
    input contains exactly M rows, all at `current_staging_generation`, and the N earlier
    rows are present but `SUPERSEDED`.
25. **A stale worker writes nothing.** A settle call carrying a generation lower than
    `current_staging_generation` returns `stale_generation`, inserts nothing, supersedes
    nothing, and does not move the segment to terminal.
26. **The DB refuses a stale write even if the RPC is bypassed.** A direct insert at a
    non-current generation is rejected by the trigger; two live (non-superseded) generations
    for one segment are rejected by `cosi_one_live_generation`.
27. **Nothing is persisted before the gate.** Failures injected at each pipeline stage —
    provider error, JSON parse, transport reconstruction, page provenance, evidence gate —
    each leave **zero** staging rows for that attempt.
28. **Consolidation reads exactly one generation per segment**, over a run deliberately
    seeded with superseded rows, failed attempts and an `OVERLAP_NOT_OWNED` set: the output
    is identical to a run with a clean history.
29. A `FAILED` segment contributes no rows to consolidation under any history.

**F — Consolidation, idempotency and governance (unchanged scope)**

30. Exact overlap duplicates collapse; boundary containment collapses keeping the longer
    excerpt and lower page; non-containing near-duplicates stay separate; same-title
    different-evidence items stay separate; collapsed confidence is the **minimum**.
31. Schema-complexity guard: the segment task's schema passes `findSchemaUnions` (≤16) and
    the optional-parameter check (≤24).
32. Idempotency: finalize twice → zero new canonical rows the second time; a re-delivered
    segment job → zero new staging rows.
33. **Migration-168 interaction:** a run held in `PROCESSING` across a drain pass is **not**
    touched by `contracts_reconcile_orphaned_executions`; the parent analysis stays `pending`
    with a null `execution_job_id` until the materialization transaction.
34. Deploy-order guard: a constant beside `RELEASE_ORDER` encodes migration-before-code, and
    the test fails if reordered.

## 20. Real acceptance test — JA10182283 (post-deploy)

**Preconditions:** migration 169 applied; code deployed; flag on for the owning
organization; queue hold released; **the historical `DEAD_LETTER` monolithic job is left
exactly where it is** (it is history, not backlog).

**Action:** trigger one new operationalization run for the signed document of JA10182283
through the ordinary product path. No manual segment creation. No manual drain required —
the run must complete on the fast path plus the Actions heartbeat alone.

**Invariants to verify:**

| # | Invariant | How |
|---|---|---|
| 1 | The 38 clauses are untouched | `count(*)` and `max(updated_at)` on `contract_clauses` for the contract, before vs after |
| 2 | Zero new full-document clause extraction | no new `contract_ai_analyses` with `kind='clause_extraction'` for this document |
| 3 | Zero monolithic operationalization calls | no new analysis with `extractor_version='contract-operationalization/1.0.0'`; no new `contracts.contract_operationalization.execute` job |
| 4 | Multiple bounded segment calls | `required_segments = 14`; 14 child analyses; every segment `duration_ms < 120_000` |
| 5 | Segment provenance complete | every segment row has non-null `execution_job_id`, `analysis_id`, `provider`, `model`, `input_tokens`, `output_tokens` |
| 6 | All required segments terminal | `count(*) FILTER (WHERE status NOT IN ('SUCCEEDED','FAILED','SKIPPED_REUSED','CANCELLED')) = 0` |
| 7 | Page partition exact | `min(owned_page_start)=1`, `max(owned_page_end)=page_count`, no gap, no overlap in owned ranges |
| 8 | Page provenance sane | every staging and canonical `source_page` ∈ `[1, page_count]`; every canonical row satisfies `ai_evidence->>'page' = source_page::text` (the DB CHECK already enforces it — verify it never had to fire) |
| 9 | Deterministic consolidation | no two canonical rows in the same family share `(source_page, source_excerpt)`; every `COLLAPSED` staging row points at an `ACCEPTED` fingerprint |
| 10 | Canonical families populated where evidence supports it | non-zero counts across `contract_obligation_definitions` / `billing_conditions` / `guarantees` / `insurance_requirements` / `indexation_rules`, each traceable to a page + excerpt; an empty family is acceptable **only** if no interpretation of that family exists |
| 11 | No fabricated human action | every canonical row `ai_origin='apex_ai'`; no approval, acceptance, review or assignment row created by the run; `requires_attention` items present in `contract_operational_interpretations` and **absent** from canonical tables |
| 12 | No orphan running analyses | zero `contract_ai_analyses` with `status='running'` for this contract after the run is terminal; run `status='COMPLETED'` |
| 13 | No duplicate operational objects | re-running finalize (deliberately, via the recovery RPC in non-dry-run) adds **zero** canonical rows |
| 14 | Cost within expectation | `sum(input_tokens)` across segments ≤ 1.3× the recorded monolithic attempt's input tokens |
| 15 | No manual drain dependency | the run reaches `COMPLETED` with no operator-triggered drain in the window |

Production mutation budget for the test: one new run and its derived rows. Nothing is
deleted, nothing historical is rewritten.

---

## 21. Critical review — risks actively hunted and where they are resolved

| Risk | Resolution |
|---|---|
| **P0 — Hobby runtime violation from batch claiming.** `drainOnce` leases 5 jobs (stamping `PROCESSING` and charging `attempt_count` for all of them) and then runs them sequentially without re-checking the budget; 5 segments = 750s in a 300s function. | §13.2 — claim exactly one job per call, re-evaluate the host budget before every claim, never lease work that cannot begin, release rather than execute when the margin evaporates, `SKIP LOCKED` preserved, no intra-invocation parallelism. `apex_jobs_release` is now **required**. |
| **P0 — a long AI handler running inside a user route's leftover lifetime.** `scheduleFastDrain` executes `drainOnce` inline in `after()`, where the remaining host budget is unknown and already partly spent by the upload itself. | §13.1 — the user route commits durable work and issues only a best-effort authenticated **wake**; the dedicated `/api/platform/jobs/drain` invocation, with its own measured 300s lifetime, executes the queue. No long handler may run in a user-route invocation. |
| **P0 — a truncated reading presented as a complete one.** | §7.1.1 — `max_tokens`, any non-allow-listed stop reason, unparseable JSON and malformed transport each **fail** the segment; no staging, no `SUCCEEDED`, no salvage of partial items. `items: []` with a clean stop remains a valid empty reading. |
| **P0 — a retry accumulating staging on top of an earlier attempt**, producing two near-identical readings that neither consolidation rule would collapse. | §8.2.1 — `staging_generation`, persistence only after the full gate pipeline, generation-checked atomic supersession, a DB trigger and `cosi_one_live_generation` index, and a consolidation query pinned to exactly one authoritative generation per segment. |
| **P0 — a static budget assertion that cannot see the clock.** "50s + 150s < 300s" is true of a claim at t=50s and false of the identical claim at t=180s. | §7.2 — the invariant is `elapsedBeforeClaim + SEGMENT_JOB_WORST_CASE < 300s`, evaluated dynamically before every claim, with per-job-class worst cases and a conservative default for unknown types. |
| **Migration 168 kills every in-flight run.** A parent analysis held `running` while its plan job is `COMPLETED` matches `contracts_reconcile_orphaned_executions`'s predicate exactly. | §11.1 — parent starts `pending` with `execution_job_id = NULL` and is `running` only inside the one materialization transaction. 168 is not modified. |
| **Duplicate segment execution** (at-least-once delivery, lease reaping). | Deterministic idempotency key per `(run_id, segment_index, recovery_generation)` + `aj_idempotent`; `cosi_segment_fact_unique` makes a re-delivered write a conflict, not a doubling; the segment handler returns `{skipped}` when the run is terminal. |
| **Duplicate materialization.** | §10 — one transaction, `ON CONFLICT DO NOTHING` against migration 160's existing partial unique indexes plus `copi_analysis_fact_unique`; `cor_one_completed_reading`. |
| **Race: two segments finish at once, both enqueue finalize.** | `contracts_operationalization_segment_settle` locks the run row and counts inside the same transaction; finalize's idempotency key is `{run_id}` alone. |
| **Race: two uploads / two drains start two runs.** | `cor_one_open_run` partial unique index. |
| **Job dependency deadlock** (fast path lost → finalize never enqueued). | §8.4 — durable sweep in `SCHEDULED_PRODUCERS` decides from stored state, never from an in-flight promise. |
| **Segment overlap errors** — a page owned twice or not at all. | Generated `owned_page_*` columns, `cos_first_no_overlap`, a run-level partition assertion at the end of PLANNING, and a unit test over the pure function. |
| **Page-number provenance errors** — local index leaking into canonical evidence. | §6.3 — bounded local index, explicit remap, redundant global bound check, a staging trigger that recomputes the mapping in SQL, and migration 160's pre-existing `ai_evidence->>'page' = source_page` CHECK as the final barrier. |
| **Model citing outside its slice.** | Structurally impossible: it only ever sees a subset document and only ever returns a local index. |
| **Partial-truth exposure.** | Canonical writes happen **only** inside the finalize transaction. Staging is never read by the product. UI derives its label from run status, and the progress bar is clamped below 100% until `COMPLETED`. |
| **Unsafe cache reuse.** | §15 — `document_sha256` + segmentation/operationalization/prompt/model versions all inside the fingerprint; reuse off by default in phase 1; bytes re-hashed and verified at the start of every segment execution. |
| **A failed new run destroying a good previous result.** | Materialization is insert-only; no path deletes or updates a canonical operational fact; a failed run writes nothing canonical at all. |
| **Infinite retries.** | Segment jobs `max_attempts = 2`; plan/finalize `3`; no automatic whole-run restart; recovery is an explicit, dry-run-by-default RPC. |
| **Excessive provider cost.** | §5.1 — segmentation re-sends only the ~14% overlap, so expected cost is ~1.15× the monolith, not 14×. Measured as acceptance invariant #14. Fan-out is staggered and executed sequentially by the worker. |
| **Provider rate limiting under fan-out.** | Staggered `run_after`, sequential execution, `429` classified retryable with the existing jittered exponential backoff in `apex_jobs_fail`. |
| **Truncated segment output passing as complete.** | See the P0 row above; §7.1.1 in full. |
| **Hidden dependency on manual drain.** | §13.3 — an immediate best-effort wake after every durable enqueue, plus GitHub Actions as the durable continuation plane (`*/5` if implementation validation confirms the cadence is honoured; otherwise `*/10`). Correctness rests on durable jobs + `aj_idempotent` + `SKIP LOCKED`, never on a schedule. Acceptance invariant #15 tests it. |
| **Self-continuation runaway.** | Removed from V1 entirely (§13.3). No recursive drain, no depth counter, no new authorization surface to re-argue. Deferred, to be reconsidered only against measured end-to-end run time. |
| **A forgeable header being mistaken for authorization.** | `authorizePlatformCron` is unchanged and mandatory: `Authorization: Bearer` only, constant-time, two caller classes. `x-apex-trigger`/`x-vercel-cron` are diagnostic labels logged **after** the credential is validated. Test 15 asserts no header can substitute for the token. |
| **Silent page truncation on an oversized document.** | §5.2 — `document_too_large` is a terminal, explicitly named refusal with zero segments, zero jobs and zero provider calls. Truncating, widening segments, or materializing the first 60 slices are all explicitly forbidden. |
| **Fingerprint family-naming divergence** between interpretations (plural) and canonical facts (singular). | §17.1 — reproduced exactly, documented, and covered by a test. Not "fixed". |
| **`ai_requesting_user_id NOT NULL`** rejecting an automatic run's materialization at the last step. | §12 — `requested_by` is `NOT NULL` on the run and planning refuses to start without it, so the failure is visible at PLANNING rather than after 14 paid calls. |
| **Encrypted / unparseable PDF.** | PLANNING fails terminally; no fallback to a whole-document call. |
| **Document changed between planning and a segment call.** | Each segment re-hashes the bytes and fails terminally on mismatch. |
| **Unbounded fan-out on a huge document.** | `MAX_SEGMENTS_PER_RUN = 60`; beyond it the run fails closed at PLANNING with `document_too_large` and its own UX label (§5.2). |

---

## 22. Explicitly out of scope

Clause extraction, the attention/exception policy (migration 154), schedule anchoring
(155), amendment diff processing (165), billing/measurement chains (Phase 7), the Apex
follow-up plane, the onboarding intake model, and every UI outside the operationalization
progress label.

Beyond the operationalization domain, this spec touches exactly three things in the platform
queue, each because a segmented pipeline cannot be correct without it:

1. worker admission — claim one job at a time with a dynamic host-budget check (§13.2);
2. `apex_jobs_release`, the RPC that admission depends on (§13.2.1);
3. the user-route fast path, which becomes a wake instead of an inline drain (§13.1).

Nothing else.

### 22.1 Deferred (not rejected)

- **Recursive self-continuation** (`x-apex-continuation` depth chaining). Removed from V1:
  the post-enqueue wake closes the same latency gap without a recursive HTTP pattern, a
  depth counter, a runaway-cost failure mode, or a new authorization surface. Reconsider
  only if measured end-to-end time on a real 195-page contract is unacceptable **and** the
  wake is demonstrably not the cause.
- **Segment result reuse** (§15) — designed, off by default, enabled only after real numbers.
- **Amendment-driven selective invalidation** (§16) — columns reserved, unused in V1.
- **Raising `MAX_SEGMENTS_PER_RUN`** — a versioned decision that bumps `segmentation_version`
  and invalidates reuse, never an accident of input (§5.2).
