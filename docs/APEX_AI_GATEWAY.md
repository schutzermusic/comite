# Apex AI Gateway — Phase 7.6

All production LLM access crosses the server-only `src/lib/ai/gateway` boundary. Domain modules select a typed task and declare required capabilities; they never select a provider or model.

## Production call-site inventory

| Domain capability | Task | Structured | PDF | Deterministic behavior |
| --- | --- | --- | --- | --- |
| Contract clause extraction | `CONTRACT_EXTRACTION` | yes | yes | evidence validation and human-review proposal gate remain mandatory |
| Contract risk scan | `CONTRACT_RISK_ANALYSIS` | yes | no | no deterministic state is changed if AI fails |
| Finance risk scan | `FINANCE_RISK_ANALYSIS` | yes | no | canonical ledger remains the source of truth |
| Project risk scan | `PROJECT_RISK_ANALYSIS` | yes | no | canonical project data remains the source of truth |
| Workforce advisor | `WORKFORCE_ADVISOR` | yes | no | consumes only the deterministic summary |
| Payroll narrative | `PAYROLL_NARRATIVE` | yes | no | deterministic narrative fallback remains available |
| Meeting minutes | `MEETING_MINUTES` | yes | no | output is a draft, not a decision or action |
| MS Project schedule fallback | `PROJECT_SCHEDULE_EXTRACTION` | yes | yes | deterministic parser runs first and validates AI rows |
| ASO extraction fallback | `ASO_EXTRACTION` | yes | yes | deterministic parser runs first; every result remains pending human review |

`EXECUTIVE_SYNTHESIS` and `COMPLEX_ESCALATION` are registered policies with no production call site yet. This phase does not create agents or actions.

## Routing and safety

- Anthropic is the only implemented adapter and the initial production provider.
- All current production tasks default to `claude-sonnet-5` (including contract extraction, project schedule extraction, and ASO extraction).
- Opus (`claude-opus-5`) is never used automatically and is never an automatic fallback; it is reserved exclusively for explicit future escalation targets (`COMPLEX_ESCALATION`).
- Domain code cannot pass model IDs.
- OpenAI and Google have typed adapter interfaces but are not enabled until concrete adapters are implemented and registered.
- High-risk policies have no fallback providers. A provider change can occur only when explicitly listed by task policy.
- Requests require a server-validated `organizationId`. Prompt caches are provider-scoped request hints only; Apex stores no shared customer prompt cache.
- Provider errors, timeouts and retryability are normalized by the gateway. Only retryable errors are retried.
- Logs expose task/provider/model/token counts/duration/attempts and never log prompts or documents.

## Server environment

| Variable | Meaning |
| --- | --- |
| `APEX_AI_ENABLED` | Set to `false` to disable all LLM calls. Deterministic workflows continue. |
| `ANTHROPIC_API_KEY` | Server-only Anthropic credential. |
| `APEX_AI_ANTHROPIC_MODEL` | Default production model override (defaults to `claude-sonnet-5`). |
| `APEX_AI_ANTHROPIC_HIGH_RISK_MODEL` | Production high-risk task model override (defaults to `claude-sonnet-5`). |
| `APEX_AI_ANTHROPIC_COMPLEX_MODEL` | Explicit complex-escalation model override (defaults to `claude-opus-5`). |
| `APEX_AI_ANTHROPIC_ESCALATION_MODEL` | Explicit escalation target model override. |
| `APEX_AI_TIMEOUT_MS` | Default request timeout. |
| `APEX_AI_MAX_ATTEMPTS` | Maximum attempts for retryable failures. |

Never expose provider keys through `NEXT_PUBLIC_*` variables.

## Persisted provenance

Migration `152_apex_ai_gateway_provenance.sql` adds provider/model and token usage to AI risks, contract analyses/proposals, payroll reports, ASO documents, and AI-parsed schedule imports. Legacy AI rows are marked `unknown_legacy` only when their original provider/model cannot be recovered.
