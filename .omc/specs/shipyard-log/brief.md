# Mission Brief (C1)

## Objective
Build **Shipyard Log**: a tiny local web app to record, categorize, and close dogfood **findings** about the shipyard harness, with stats and a markdown export that feeds the shipyard feedback loop.

## Scope boundary
- Single-user, local, no auth, no build step
- Storage: JSON file; backend: zero-dependency Node; frontend: vanilla HTML/CSS/JS styled only by design tokens
- The app's first real user is the dogfood run that builds it: from ticket T2 onward, all shipyard findings must be recorded through this app (dogfooding the dogfood tracker)

## Non-goals
- Multi-user / auth / database / CI (revisit at T5)
- Generic issue tracker features (labels, assignees) — this is a single-purpose loop tool
