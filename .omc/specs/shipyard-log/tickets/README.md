# Tickets — Shipyard Log

> C3 approved (human stand-in, 2026-08-29): granularity = 5 vertical slices, edges below, no merges/splits.
>
> 推进模型：frontier（blockers 全完成即可领）。边：T1 → {T2,T3} → {T4} → {T5}，且 T5 另依赖 T2、T3。

| id | title | blockedBy |
|----|-------|-----------|
| T1 | keel: storage module + test harness | — |
| T2 | findings HTTP API | T1 |
| T3 | log UI (list/create/status, tokens only) | T1 |
| T4 | stats + markdown export | T2, T3 |
| T5 | e2e smoke + CI + dogfood round-1 closeout | T2, T3, T4 |
