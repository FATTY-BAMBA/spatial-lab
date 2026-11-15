---
status: research
priority: P2
owner: researcher → product-engineer
depends: [T-002]
---
# T-008 Pricing plans + payments

**Research** (`docs/research/T-008-payments.md`): pricing for Taiwan design firms (per seat / per project / render
credits), competitors' prices, ECPay vs Stripe (Taiwan company 首越人工智能有限公司, invoices 電子發票), subscription +
usage limits (AI renders cost ≈ NT$4 each).

**Acceptance criteria.** Owner-approved pricing; checkout in test mode end to end; plan limits enforced server-side
(`api/render.js`, `api/vision.js`); no live money path without owner sign-off.
