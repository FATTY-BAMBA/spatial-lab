# Task board

One file per task: `T-xxx-name.md`, with front matter `status` (todo · research · building · review · done · blocked),
`priority` (P0 = before the client demo, P1 = soon, P2 = later), `owner` (role) and `depends`. Agents pick the highest-priority
`todo` whose dependencies are done, follow the loop in `AGENTS.md`, and keep this table current.

| Task | Priority | Status | Owner |
|---|---|---|---|
| [T-001 DWG upload](T-001-dwg-upload.md) | P0 | research | researcher → import-engineer |
| [T-002 Firm profile + branded proposal](T-002-branded-proposal.md) | P0 | todo | product-engineer |
| [T-003 Price list + Excel quote](T-003-price-list-excel.md) | P0 | todo | product-engineer |
| [T-004 Record AI for all image fixtures](T-004-record-fixtures.md) | P0 | blocked: fixtures repo | qa-engineer |
| [T-005 Room/balcony split behind sliders](T-005-balcony-split.md) | P1 | review | import-engineer |
| [T-006 Hand-drawn watercolor plans](T-006-watercolor-plans.md) | P1 | todo | import-engineer |
| [T-007 Client demo kit](T-007-demo-kit.md) | P0 | todo | product-engineer |
| [T-008 Pricing plans + payments](T-008-payments.md) | P2 | research | researcher → product-engineer |
| [T-009 Viewer performance + visual QA](T-009-viewer-qa.md) | P1 | todo | viewer-engineer + qa-engineer |
