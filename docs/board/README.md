# Task board

One file per task: `T-xxx-name.md`, with front matter `status` (todo · research · building · review · done · blocked),
`priority` (P0 = before the client demo, P1 = soon, P2 = later), `owner` (role) and `depends`. Agents pick the highest-priority
`todo` whose dependencies are done, follow the loop in `AGENTS.md`, and keep this table current.

| Task | Priority | Status | Owner |
|---|---|---|---|
| [T-001 DWG upload](T-001-dwg-upload.md) | P0 | done — merged e57ddab + T-001b 5b578be, live verified | import-engineer |
| [T-002 Firm profile + branded proposal](T-002-branded-proposal.md) | P0 | done — merged b552d38, migration applied; live check pending | product-engineer |
| [T-003 Price list + Excel quote](T-003-price-list-excel.md) | P0 | done — merged 43de2cc, migration applied, live-checked 2026-11-17 | product-engineer |
| [T-004 Record AI for all image fixtures](T-004-record-fixtures.md) | P0 | blocked: fixtures repo | qa-engineer |
| [T-005 Room/balcony split behind sliders](T-005-balcony-split.md) | P1 | done | import-engineer |
| [T-006 Hand-drawn watercolor plans](T-006-watercolor-plans.md) | P1 | todo | import-engineer |
| [T-007 Client demo kit](T-007-demo-kit.md) | P0 | review — merged 94843d8 (validated round 2), live; N9/N10 fixed on `agent/T-011-demo-polish`; awaiting owner: script review, O1 pilot pricing, NT$4 live render | product-engineer |
| [T-008 Pricing plans + payments](T-008-payments.md) | P2 | research | researcher → product-engineer |
| [T-009 Viewer performance + visual QA](T-009-viewer-qa.md) | P1 | todo | viewer-engineer + qa-engineer |
| [T-010 Share from the viewer + QR code](T-010-share-from-viewer.md) | P1 | done — merged d65e8db, live-checked 2026-11-17 | viewer-engineer |
| [T-011 Save the chosen style with the project](T-011-project-style.md) | P1 | done — merged d65e8db, live-checked 2026-11-17 | viewer-engineer |
| [T-012 AI health check before a demo](T-012-ai-health-check.md) | P1 | done — merged db94728, live-checked 2026-11-17 | product-engineer |
| [T-013 The demo client's own plans in the fixtures](T-013-client-plans.md) | P0 | todo — needs the owner (client plans) | owner → qa-engineer |
