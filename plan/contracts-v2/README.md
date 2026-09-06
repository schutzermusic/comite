# Contracts V2 — Docs Pack

Recommended repository path:

```text
plan/contracts-v2/
├── README.md
├── architecture.md
├── phase-1.md
├── phase-2-execution.md
└── deferred-items.md
```

For Phase 2, give Codex only this short instruction:

```txt
Execute Contracts V2 — Phase 2.

Read and follow:
plan/contracts-v2/phase-2-execution.md

Treat it as the approved Phase 2 execution specification.

Before implementation, confirm Phase 1 is merged into main and production is green.
Create feat/contracts-v2-phase-2 from updated main.

Do not re-audit the entire repository.
Use at most 2 focused subagents only if parallelism materially saves time.
Do not start Phase 3+.
Do not apply migrations until the preflight and apply gate in the MD pass.
Do not merge main automatically.
Do not commit incidental .preview changes.

If a STOP condition in the MD is triggered, stop and report it instead of improvising a new architecture.

At completion return the concise report and final gates required by the MD.
```

The Lead should read the phase specification. Subagents should receive only the relevant scoped requirements rather than the entire architecture pack.
