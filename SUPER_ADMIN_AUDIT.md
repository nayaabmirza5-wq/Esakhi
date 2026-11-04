# Super Admin Dashboard Audit and Implementation Checklist

Audit date: 2026-10-30

## Figma Reference

The supplied Figma Make URL could not be inspected with the available page-fetch tool; it returned no extractable page content. No visual comparison or claim of Figma fidelity is made in this audit. Before visual implementation, provide exported screenshots/frames for the overview and representative list/detail screens, plus any accessible design assets or a link with view access.

## Repository Baseline

- Frontend: React 19, TypeScript, Vite 7, and React Router 7. Super Admin routes, page components, API calls, and dashboard styling are currently concentrated in `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/types.ts`, and `frontend/src/styles.css`.
- Backend: Express 5, TypeScript, MongoDB/Mongoose, and Zod. API mounting is in `backend/src/app.ts`; Super Admin routes/controllers are in `backend/src/modules/superAdmin/`.
- Authentication: `SuperAdminGate` checks the current frontend role. All `/api/v1/super-admin/*` routes use `requireAuth` and `requireRole('super_admin')`. Existing admin order, product, customer, delivery-partner, and settings route groups explicitly allow `super_admin` where registered.
- Current Super Admin data APIs: overview, orders, city summaries/details, City Admin list/detail/create/update, seller list/detail, and paginated audit logs. Other real data is available through authorized admin endpoints.
- Existing reusable UI: collapsible/mobile sidebar, route-aware active links and breadcrumbs, KPI metrics, tables, pagination, status badges, data/error/empty states, order charts, status breakdowns, detail tables, and timeline styling. The project uses a local `useLoad` data-fetching helper; no server-state cache library is installed.
- Current city/serviceability model: one global settings record with one configured city and serviceable localities containing postal codes and delivery fees. There are no independent city or polygon/coordinate zone records.
- Existing financial records: orders contain payment method/status and manual verification events. There are no dedicated refund, seller settlement, delivery payout, or platform ledger models or provider integrations.
- Verification before this audit: the full project build passed and the backend suite passed 85 tests after the seller-application workflow changes. No lint script is defined in the root or package manifests.

## Verified Gaps

- The Super Admin shell is present but its navigation grouping/order differs from the requested information architecture. It also contains a City Admin Compensation entry that aliases the Reports route.
- The top bar has breadcrumbs, locale date, and a static profile display, but no global entity search, notifications, or help action.
- Overview is database-backed but has only order/customer/partner/product operational counts, order-value totals, a date-range order trend, fulfilment breakdown, recent orders, and a small attention list. It does not have payment collections, revenue/expense, seller/city performance, refunds/settlements/payouts, activity feed, or most requested attention queues.
- The cities screen derives city records from settings, user assignments, and order addresses. It edits the one global platform city; it cannot create or independently activate cities or edit zone records.
- City Admin management can create/provision, update assignment/name/email, enable/disable, and view accounts. It is not an invitation flow and has no last-login field.
- Seller directory/detail reads seller accounts and linked products. The separate City Admin seller application queue now persists and approves applications, but Super Admin has no application-review endpoint or SHG verification/document model.
- Product and order directories/details use live records. Super Admin screens are mostly read-only; product approval/classification/tax compliance records are absent. Order list filters in the UI are narrower than supported API filters.
- Delivery partner directory/detail uses real accounts and assignments. City/zone eligibility and partner applications are not modeled.
- Customer list/detail uses real customer and order APIs. Search and city filters are absent; personal data visibility needs a dedicated permission review before expansion.
- External providers, support/disputes, refunds, seller settlements, and delivery payouts render explicit unavailable/placeholder screens because their data/workflows do not exist.
- Payments displays order-level payment state, not independent payment transactions or reconciliation records.
- Reports reuse the overview endpoint and city summaries; there are no dedicated filtered report/CSV APIs.
- Platform Settings reuses existing global marketplace settings. It does not include tax, commissions, integrations, or financial controls.
- Roles & Permissions is a read-only summary of backend role boundaries; there is no configurable action-level permission matrix.
- Security & Audit Logs displays persisted events with pagination but has no filters for date, actor, action, entity, outcome, or city. The current audit schema does not record a standardized outcome or city field.

## 18-Page Implementation Checklist

Status key: **Partial** means a real route and some live data/actions exist; **Missing** means there is no real domain workflow/API. All page-specific visual matching remains **unverified** until Figma exports are available.

| # | Page | Current repository capability | Implementation checklist |
|---|---|---|---|
| 1 | Overview | **Partial:** real global overview, trend, fulfilment chart, recent orders, limited attention list. | Add only metrics backed by defined aggregates; add seller/city/finance queues and admin activity when supported; define each total; make attention links filter their destinations. |
| 2 | Cities & Service Zones | **Partial:** derived city list/detail, single global city settings, localities/PIN codes. | Decide a multi-city/zone ownership model; add validated CRUD, launch state, unique city identity, overlap/serviceability checks, scoped metrics, and tests. Do not imply polygon coverage. |
| 3 | City Administrators | **Partial:** real list/detail/create/update/status APIs. | Reconcile requested one/multiple-city assignment policy; add invitation only with a real secure delivery flow; retain audited status/assignment changes; expose last login only if recorded. |
| 4 | Sellers & SHGs | **Partial:** real seller account list/detail/products; City Admin seller-application workflow exists separately. | Add Super Admin application visibility/review if policy requires it; model SHG profile, verification, FSSAI, tax classification, documents, products/orders/sales/settlements as distinct states and scoped data. |
| 5 | Products & Inventory | **Partial:** live list/detail and inventory fields; admin APIs support product edits. | Add moderation status and review endpoints, seller/city filters, activity history, approved classification/tax records, and separate food compliance. Never derive GST/HSN from category alone. |
| 6 | Orders & Assignments | **Partial:** live cross-platform list/detail; backend supports status, payment, and assignment workflows. | Expand filters to date/city/seller/customer/assignment, show multi-seller items and timeline, and expose mutations only when role policy permits; test transitions and partner eligibility. |
| 7 | Delivery Partners | **Partial:** live directory/detail, assignment counts, status endpoint. | Add account application/onboarding, city/zone eligibility, completed/failed metrics and payout history only after corresponding records exist; ensure selectors exclude ineligible accounts. |
| 8 | External Delivery Providers | **Missing:** placeholder; no provider model or integration. | Identify an actual provider and official API/configuration before implementing connection testing, serviceability, credentials, or shipment events. |
| 9 | Customers | **Partial:** live paginated directory, profile, and orders. | Add supported search/filters and invalidate/refetch after actions; define least-privilege fields and customer activity/refund/support relations. |
| 10 | Support & Disputes | **Missing:** placeholder; no case model, assignment, or communication service. | Define case ownership, valid transitions, private/public notes, escalation, audit, and real messaging dependency. |
| 11 | Payments | **Partial:** order payment method/status and manual review history. | Add transaction/reconciliation model and provider references only if supplied by a real gateway; separate collected payments from order value and platform revenue. |
| 12 | Refunds | **Missing:** placeholder; no refund model or gateway refund API. | Implement reasoned review independently from payment status; execute money movement only through an authorized configured provider and record its actual result. |
| 13 | Seller Settlements | **Missing:** placeholder; no immutable ledger or settlement model. | Define eligible sales, returns, commissions, tax on commission, TCS/other deductions, payable snapshots, idempotent approval/payment and reconciliation before displaying balances. |
| 14 | Delivery Partner Payouts | **Missing:** placeholder; no payout ledger. | Define eligible completed deliveries, adjustments, payable snapshots, duplicate prevention, payment result and audit trail. |
| 15 | Reports & Analytics | **Partial:** real order trend/status and city summaries. | Add server-side aggregates and shared filters; define metrics; implement authorized CSV exports; do not infer missing financial or performance figures. |
| 16 | Platform Settings | **Partial:** existing global marketplace settings/API. | Preserve supported controls; add tax, commission, integrations, retention, or launch settings only with validated backend contracts, permissions, audit and confirmation. |
| 17 | Roles & Permissions | **Partial:** static role/scope summary; backend middleware is authoritative. | Document actual action matrix and test all protected routes; do not present configurable permissions unless a backend permission model is implemented. |
| 18 | Security & Audit Logs | **Partial:** real paginated audit records and actor identity. | Add indexed server-side filters and safe metadata; add outcome/city fields only where reliably captured; protect log mutation/deletion and test masking. |

## Shared Shell Checklist

- [ ] Reorder/group all 18 requested destinations exactly; remove route aliases that imply unsupported modules.
- [ ] Compare sidebar, topbar, typography, spacing, palette, icons, cards, and page composition against supplied Figma frames.
- [ ] Add supported-entity global search with server-backed result types and no-results/error states.
- [ ] Add notifications/help/profile actions only when their destinations and data exist.
- [ ] Verify direct navigation, refresh, browser history, active navigation, keyboard accessibility, and responsive use at desktop/tablet/mobile sizes.
- [ ] Keep permission denial, empty, loading, and API error states explicit; never substitute production fixtures or false success.

## Safe Implementation Order

1. Receive Figma exports/access and map frames to the existing shell and 18 routes.
2. Resolve capability and policy questions for multi-city zones, invitations, moderation, data privacy, finance, and external providers.
3. Implement the shared shell and navigation to the verified design; retain the existing marketplace and role guards.
4. Complete existing-data pages and filters using current APIs before adding new schemas.
5. Add missing domain models/endpoints in dependency order: city/zone scope, moderation/compliance, support, payment/refund, then immutable settlement/payout ledgers and reports.
6. Add backend authorization, validation, audit, transaction/idempotency and cross-city tests with each API.
7. Verify routes/interactions, responsive layouts, builds, tests, and configured integrations. Mark external-dependent capabilities unavailable until genuinely configured.

## Required Figma Input

Please provide exported screenshots or frame images for the Super Admin overview, sidebar/topbar, and representative list/detail/form states (or enable view access to the Figma file). Include any icon/font/image assets and note desktop/mobile frames. The visual implementation is intentionally paused until these are available so it can follow the stated source of truth rather than an invented dashboard design.

## City Selector Data Source

The Super Admin city selector uses the GeoNames daily `cities15000.zip` extract (India records with populated-place feature class and GeoNames' `cities15000` population/admin-seat threshold), mapped to state names using `admin1CodesASCII.txt`. The resulting compact JSON is checked into `frontend/src/data/indiaPopulatedPlaces.json`. GeoNames publishes this data under CC BY 4.0 and states that it is provided as-is; names are a selection aid, not an official serviceability boundary or a replacement for verified city/zone configuration. Attribution is shown next to the selector. Bengaluru and Mysuru map to Karnataka; Jabalpur maps to Madhya Pradesh in the included extract.