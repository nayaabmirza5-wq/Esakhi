# eSakhi — Overall Product Requirements Document (PRD)

**Document status:** Consolidated working draft for review  
**Product:** eSakhi — Handmade with Love. Empowered by You.  
**Initial launch market:** Damoh, Madhya Pradesh, India  
**Product model:** Local marketplace for ready-made handmade products created by women’s Self-Help Groups (SHGs)  
**Primary objective:** Build a trustworthy, operationally complete marketplace with distinct dashboards for every user role, secure order fulfilment, transparent money movement, and a foundation for adding more cities later.

> **Implementation rule:** This PRD describes the intended product. It does not mean every feature already exists in the current repository. First audit the existing backend, routes, schemas, environment, and tests. Preserve working code, map current capabilities to this PRD, and implement missing features in small, tested phases. Never show fake data or report an action as successful before the backend confirms it.

---

## 1. Product vision and principles

eSakhi helps customers discover and buy handmade products while creating a digital sales channel for women-led SHGs. It also gives local operations teams the tools to manage sellers, inventory, delivery, payments, settlements, and customer support.

### Product principles
- **Local-first:** Launch only in approved Damoh service areas. Do not silently accept orders from outside the configured area.
- **People-first:** Respectfully tell the SHG maker story. Use genuine photographs only with permission; never present stock or AI-generated people as actual SHG members.
- **Ready-made inventory:** Products are existing stock, not made-to-order unless a future product policy explicitly adds that option.
- **Operational clarity:** Every order, assignment, payment, refund, handover, settlement, and payout has a defined status and audit trail.
- **Least privilege:** Each role sees only the information and actions required for that role.
- **Truthful UI:** All products, prices, stock, settings, order data, metrics, and financial records come from the backend. No fake ratings, order counts, revenue, stock, or success messages.
- **Expandable architecture:** Start with one city but keep city/service-zone identifiers and permissions ready for future expansion.
- **Accessible and responsive:** Support mobile-first use, desktop operations, keyboard navigation, readable contrast, and reduced motion.

## 2. User roles and separate workspaces

Create role-specific routes, navigation, APIs, and authorization. Hiding a button in the frontend is not security; the backend must enforce permissions.

### 2.1 Customer storefront and account
Customers browse products, manage addresses, place orders, pay using enabled methods, track orders, request cancellation where eligible, and contact support.

### 2.2 SHG / Seller dashboard
Approved SHGs manage their seller profile and permitted product/inventory information, receive order preparation tasks, mark packing/readiness steps where authorized, and view sales and settlement records. Seller registration remains pending until reviewed and approved.

### 2.3 Delivery Partner dashboard
A delivery partner sees only orders assigned to that partner, essential pickup/customer delivery information, delivery instructions, permitted contact information, delivery status actions, delivery QR/label details, COD collection records, cash handovers, and earnings/payout history. A partner must never browse all customers or unassigned orders.

### 2.4 City Admin dashboard
A City Admin operates only their assigned city and service zones. They manage local SHGs/sellers, products and stock where authorized, orders, manual delivery assignments, partner accounts, local support, COD collection/handover records, exceptions, and local operational reports. City Admin permissions must not extend to other cities or global platform settings unless explicitly granted.

### 2.5 Super Admin dashboard
The Super Admin oversees the platform across cities, approves or appoints City Admins, configures cities and service zones, manages roles and permissions, reviews platform-wide reports, verifies bank deposits/remittances, oversees refunds and settlements, manages policies/settings, and reviews audit/security events.

### 2.6 Finance / Accounts workspace (permission-based)
If finance staff are added as a distinct role, they should see only permitted payments, refunds, reconciliations, seller settlements, partner payouts, City Admin compensation, bank deposits, ledgers, and reports. Until that role is formally approved, these modules remain accessible only to explicitly authorized admins.

### 2.7 Customer support workspace (optional separate role)
If introduced, support staff can view necessary customer/order information, create support cases, add internal notes, and escalate issues. They cannot change payment verification, issue refunds, alter role permissions, or edit financial ledgers unless separately authorized.

---

## 3. City and service-zone model

### Launch scope
- Initial city: **Damoh, Madhya Pradesh**.
- Start with the city-wide coverage and localities explicitly configured and approved by the business.
- Candidate localities discussed for initial configuration include Main Damoh, Ghanta Ghar, Pathani Mahalla, Nuri Nagar, Jabalpur Naka, Sagar Naka, and Gading Mahalla. Treat these as **proposed configuration values**, not guaranteed coverage, until verified and enabled by an authorized admin.
- Nearby villages such as Tendu Khaira and Gopalpura must remain unavailable until explicitly reviewed and enabled.
- Do not promise service in any locality merely because it appears in this document.

### City and zone capabilities
- Create/edit/activate/deactivate cities and service zones.
- Define delivery eligibility by city, locality, postal code, or another validated location rule supported by the backend.
- Configure delivery fee, minimum order, supported payment methods, delivery/pickup options, and operating status per city/zone where approved.
- Prevent checkout when the address is outside an active service area; explain how the customer can correct the address.
- Assign each seller, order, City Admin, and delivery partner to the appropriate city/zone scope.
- Allow a City Admin to view only their assigned city and permitted zones.
- Support future multi-city expansion without exposing cross-city data to local admins.

### Cross-zone deliveries
A seller and customer may be in different zones. The order must be considered against the configured city-level serviceability and delivery rules, not just the seller’s zone. The City Admin sees eligible orders and manually assigns an active, eligible partner who can serve the destination zone. Phase 1 should not auto-assign the nearest partner. If no eligible partner is available, keep the order in an unassigned/exception queue and show a clear reason. Zone-transfer or inter-zone fees, if any, must be defined by business rules rather than invented by the frontend.

---

## 4. Information architecture and dashboards

### 4.1 Customer storefront

**Public pages**
- Home: brand hero, Shop Handmade action, category shortcuts, real active products from the API, service-area guidance, and maker-story preview.
- Shop/catalogue: search and filters only where supported by API; categories are Bangles, Jewellery, Dupattas, and Others, reconciled against backend configuration.
- Product details: genuine images, description, price, available stock, quantity control, and add-to-cart action.
- Our Story: approved SHG story and maker information.
- Service area, delivery, payments, FAQs, privacy, terms, cancellation/refund policy, and contact/support information from approved business content.
- Sign in/register using phone OTP.

**Customer account**
- Profile and saved addresses.
- Cart with editable quantities, remove action, availability checks, and clear empty state.
- Checkout with address validation, delivery method and payment methods returned by backend configuration.
- Order confirmation using the actual server-generated order reference.
- Order history and order detail/tracking.
- Cancellation request where allowed by current order status and policy.
- Support/help entry point.

**Customer dashboard summary**
- Recent orders and current order statuses.
- Saved addresses and profile.
- Payment/refund status for the customer’s own orders.
- No internal notes, partner private details, seller settlement information, or other customers’ data.

### 4.2 SHG / Seller dashboard

**Navigation**
- Overview
- SHG profile and verification
- Products
- Inventory
- Incoming orders / preparation
- Sales
- Settlements and payout history
- Notifications
- Help/support

**Capabilities**
- Submit SHG/seller application with group name, authorized contact, phone, address, city/zone, required verification information, and bank/payout details through a secure flow.
- Show application status: Draft, Submitted, Under Review, Needs Information, Approved, Rejected, Suspended.
- Require review and approval before publishing products or receiving live orders.
- Manage only the seller’s own products and allowed fields.
- Maintain ready-made stock with adjustment history and reason.
- Show order items, quantities, packing/readiness deadlines, and permitted order statuses.
- Show gross sales, returns/refunds, agreed commissions/fees, net payable, paid/pending amounts, and settlement references from backend ledger data.
- Keep bank account details masked in normal views; changes to verified payout details require re-verification and audit logs.
- Sellers cannot approve their own applications, edit platform commission rules, verify their own payments, or alter payout ledger entries.

### 4.3 Delivery Partner dashboard

**Navigation**
- Overview
- My Assigned Orders
- Order Details / Pickup
- Delivery confirmation
- COD collections and handovers
- Earnings and payouts
- Profile and availability
- Help/support

**Account lifecycle**
- Created/invited by an authorized City Admin or approved onboarding flow.
- Account has name, Indian mobile number, internal admin notes, assigned city/eligible zones, active/suspended status, and verified payout details if payouts are enabled.
- An account must be active and eligible before appearing in assignment options.
- Do not allow partners to elevate their own role or assign orders to themselves unless a future approved workflow explicitly allows it.

**Order workflow**
- Partner sees only assigned orders.
- Show relevant order ID, pickup/seller details, delivery address and contact details necessary to complete delivery, delivery instructions, order amount and payment method, and current status.
- Partner accepts/acknowledges an assignment if that step is enabled; otherwise the City Admin’s assignment remains authoritative.
- Pickup confirmation, in-transit, delivery attempt, delivered, failed delivery, return-to-seller, and exception actions must follow backend-allowed transitions.
- Failed delivery requires a reason and may require an evidence/notes flow.
- Partner must not mark an order delivered merely by opening/scanning a QR code. Server validation must verify the order, partner assignment, allowed status, and any required confirmation.

**Delivery QR and printable label**
- Generate a printable order label/QR using a server-issued opaque or signed identifier, not exposed personal data.
- QR identifies the order/label; it is not payment proof.
- Scan/verify at the doorstep and confirm delivery using the approved workflow (for example, customer confirmation/OTP where implemented).
- Prevent replay, wrong-order scans, unauthorized partner use, and duplicate completion.
- Keep manual fallback for a damaged/unavailable QR, with reason and audit trail.
- Do not claim scanning is implemented unless scanner UI and secure backend validation both exist.

**Partner earnings**
- Show completed eligible deliveries, earned amounts, adjustments, payout status, and payout reference from the ledger.
- Separate earned, approved, paid, and disputed amounts.
- A partner cannot edit their earnings or mark their own payout as paid.

### 4.4 City Admin dashboard

**Navigation**
- Overview
- City & Service Zones (read/edit only within permission)
- SHGs & Sellers
- Products & Inventory
- Orders & Assignments
- Delivery Partners
- Customers
- Support & Disputes
- Payments / COD Operations
- Refund requests (review/approve only if authorized)
- Seller settlements (view/reconcile only if authorized)
- Partner earnings/payouts (view/reconcile only if authorized)
- City reports and analytics
- City settings (limited)
- Audit activity (read-only or permission-based)

**Overview metrics**
- Orders by status
- Unassigned and overdue orders
- Orders by delivery zone
- Active sellers/SHGs
- Low-stock items
- Active/available delivery partners
- Failed delivery and cancellation exceptions
- COD outstanding, cash handovers pending, bank remittances pending
- Pending seller/partner operational actions
All metrics must come from real API responses and include loading, empty, and error states.

**Order assignment**
- Create and manage delivery partner accounts.
- Account creation form includes partner name, Indian mobile, internal notes, city and eligible zones, status, and required onboarding details.
- Newly approved/active eligible partner appears in the assignment dropdown without a manual page refresh when practical.
- Assignment UI displays partner name and mobile clearly.
- Support assigning multiple eligible orders to one partner, reassignment with a reason, and visibility of the current assigned partner in every relevant order list/card.
- Preserve a manual assignment option only if it has a defined operational meaning; do not leave a confusing “Manual assignment (legacy)” option as the only choice.
- Reject assignments to inactive, suspended, wrong-city, or destination-ineligible partners.
- Assignment changes must be recorded in the audit trail.

**City boundaries**
- City Admin cannot create/edit another city or view other cities’ private data.
- City Admin cannot appoint Super Admins or alter global permissions.
- City Admin cannot verify a bank deposit they made if separation of duties requires independent verification.

### 4.5 Super Admin dashboard

**Navigation**
- Global Overview
- Cities & Service Zones
- City Administrators
- SHGs & Sellers
- Products & Inventory (cross-city oversight, permission-controlled)
- Orders & Assignments (cross-city oversight)
- Delivery Partners
- External Delivery Providers
- Customers
- Support & Disputes
- Payments & Reconciliation
- Refunds
- Seller Settlements
- Delivery Partner Payouts
- City Admin Compensation
- Platform Revenue & Expenses
- Reports & Analytics
- Platform Settings
- Roles & Permissions
- Security & Audit Logs

**Global overview**
- Orders and fulfilment by city
- Gross order value, collected payments, refunds, outstanding COD, verified bank deposits, seller liabilities, partner liabilities, City Admin compensation liabilities, platform revenue and expenses
- Pending approvals and unresolved operational/financial exceptions
- Serviceable cities/zones and activation status
- Never treat gross order value as platform revenue.

**City administration**
- Create city records and service zones.
- Appoint/revoke City Admin access with scoped permissions.
- Define which admin is responsible for which city and dates of assignment.
- Review city performance and operational exceptions.
- Enable new localities/villages only after operational coverage, pricing, delivery feasibility, and policy approval.

**External delivery providers**
- Keep internal delivery partners separate from third-party logistics providers such as Shiprocket, Amazon Shipping, or other services.
- Do not advertise provider coverage or availability until a contract, serviceability check, rates, and integration have been verified.
- Track provider configuration, eligible areas, tracking references, pickup/delivery statuses, costs, exceptions, and reconciliation if integration is approved.
- Manual local delivery remains a supported initial path.

### 4.6 Finance and reconciliation workspace

**Navigation**
- Payment transactions
- Payment verification queue
- COD collection ledger
- Cash handovers
- Bank remittances/deposits
- Reconciliation and discrepancies
- Refunds
- Seller settlements
- Delivery partner payouts
- City Admin compensation
- Platform revenue and expenses
- Reports/export
- Finance audit log

Access is permission-based. Financial records should be immutable or corrected with adjustment entries, not silently overwritten.

---

## 5. Catalogue, seller, and inventory rules

- Product categories for launch: **Bangles, Jewellery, Dupattas, Others**.
- Only active, approved, available products are visible to customers.
- Inventory represents ready-made stock.
- Product fields must match the actual backend schema. Suggested fields, subject to schema approval: seller/SHG ID, city/zone, name, slug, description, category, price, stock, images, active status, SKU, dimensions/weight if needed, and created/updated audit fields.
- Product creation/editing must validate price, stock, category, image URL, seller ownership, and publication eligibility on the server.
- Stock changes use a dedicated adjustment action with quantity and reason. Maintain adjustment history.
- Checkout must revalidate current product status, price, and stock on the server. Client totals are estimates only.
- Prevent overselling with atomic/reserved-stock logic appropriate to the backend.
- Product image URLs can be used if supported. Secure image upload/storage/CDN is a separate feature until implemented.
- Do not add customer reviews, ratings, wishlists, gift cards, promo banners, coupons, or a persistent cross-device cart as if they already work. Add them only after requirements, models, APIs, moderation, and test cases are agreed.

---

## 6. Order lifecycle and fulfilment

Define allowed transitions centrally on the backend and expose only valid actions in each dashboard. Final enum names must be reconciled with the existing schema before implementation.

### Suggested operational lifecycle
1. Cart prepared.
2. Checkout submitted.
3. Order created by server; price/stock/payment method validated.
4. Payment pending, awaiting COD, or payment verified according to method.
5. Order accepted/confirmed by authorized staff.
6. Seller preparing/packing.
7. Ready for pickup.
8. Assigned to eligible delivery partner.
9. Picked up.
10. In transit / out for delivery.
11. Delivered with required confirmation.
12. Completed after required financial/operational checks, if the business uses a separate completion status.

### Exceptions
- Customer cancellation request
- Cancellation approved/rejected
- Seller unable to fulfil
- Out of stock
- Partner unavailable / reassignment
- Delivery attempt failed
- Customer unavailable / address issue
- Return to seller
- Dispute/support case
- Partial fulfilment only if explicitly supported
- Refund pending/approved/processing/processed/failed

Cancellation is not a refund. Delivery completion does not prove payment receipt. Payment receipt does not prove delivery. These are separate state machines.

---

## 7. Payments and payment verification

### Launch payment methods
- Cash on Delivery (COD), if enabled for the order’s zone.
- Manual UPI payment with explicit instructions and an admin verification workflow.
- A payment gateway such as Razorpay may be integrated later after business onboarding, merchant eligibility, webhooks, and refund rules are confirmed.

### Required safeguards
- The backend calculates final order totals and payable amount.
- UPI screenshots/receipts are not proof by themselves. Verify the actual transaction/reference through an approved method before marking payment verified.
- Payment status must be separate from order status and delivery status.
- Keep transaction reference, amount, method, timestamps, reviewer, outcome, and reason where applicable.
- Prevent duplicate payment records, replay, overpayment/underpayment errors, and unauthorized verification.
- Customer-facing UI must state pending/verified/rejected/failed accurately.
- Never store raw card data or secrets in the frontend.
- A future gateway must verify signed webhooks server-side and use idempotent processing.

---

## 8. COD collection, cash handover, and bank remittance

This is a critical accounting workflow and must not be simplified to a single “paid” toggle.

### Proposed initial flow
1. Customer places a COD order.
2. Delivery partner delivers and collects the actual amount due.
3. Partner records collection against that order.
4. Partner hands the cash to the City Admin **if that is the approved operating arrangement**; otherwise use the approved direct-deposit/handover route.
5. Record the handover as a separate event with amount, time, parties, reference/receipt, and confirmation by both sides where feasible.
6. Cash is deposited into the designated eSakhi business bank account.
7. Record deposit reference, date, amount, bank/account destination (masked in UI), and supporting evidence.
8. A separately authorized Super Admin/finance reviewer verifies the deposit against bank records.
9. Reconcile the deposit against the relevant COD collections and flag shortfalls, excess, duplicate references, or unmatched amounts.

### Required separate statuses
- Not collected
- Collected by partner
- Handover pending
- Handed over to City Admin / designated custodian
- Deposit pending
- Deposit submitted for verification
- Deposit verified
- Reconciliation discrepancy
- Resolved/adjusted with documented approval

Status labels should match the eventual ledger design. Never mark money as received by the business merely because a partner says they collected it, a cash handover was recorded, or a screenshot was uploaded.

### Risk controls
- Prefer direct deposit to the business account where practical to reduce cash-handling risk.
- Require independent verification for bank deposits.
- Use numbered handover/deposit references, audit logs, daily outstanding reports, escalation thresholds, and reconciliation deadlines.
- Never allow a person to approve their own deposit where separation of duties is required.
- Cash shortages/excess must create a discrepancy case, not silently modify an order amount.
- The exact bank-account ownership, legal arrangement, tax/accounting treatment, and responsibility for handling third-party seller funds must be confirmed with qualified Indian accounting/legal advisers before live operation.

---

## 9. Refunds and cancellations

- Cancellation request and refund are separate workflows.
- Confirm the payment was actually received before creating a refund liability.
- An unpaid COD order generally has no customer payment to refund. If COD cash was collected, the collected amount and refund must be recorded.
- Support full and partial refunds only with explicit policy, limits, and ledger entries.
- Review/approval must follow role permissions and reason requirements.
- Refund statuses: Requested, Under Review, Approved, Initiated/Processing, Processed, Failed, Rejected (final names to be aligned with implementation).
- Do not mark a refund processed just because it was approved or initiated.
- Prefer returning money to the original payment method where supported. Manual UPI/bank refunds require recorded transaction references and independent verification.
- Prevent duplicate refunds and ensure total refunded cannot exceed the verified amount paid.
- Keep the customer informed using accurate statuses and timestamps.

---

## 10. Financial ownership, ledgers, settlements, and payouts

eSakhi may coordinate collections and payouts, but the entire customer payment is not automatically eSakhi revenue. The business must define contractual ownership and revenue recognition with professional advice.

### Separate ledgers / balances
- Customer payment transactions and payment allocations
- COD collected but not handed over
- Cash handed over but not deposited
- Bank deposits pending verification
- Verified collections
- Seller/SHG payable
- Delivery partner earnings payable
- City Admin salary/incentive/commission payable
- Refund liabilities and completed refunds
- Platform commission/fees and earned revenue
- Platform expenses and adjustments
- Disputed/unreconciled amounts

### Seller settlements
- Calculate amounts using approved, versioned commission/fee rules.
- Show gross eligible sales, cancellations/returns, refunds, platform fees, other approved adjustments, net payable, payout status, and reference.
- Pay only to the verified seller/SHG payout account.
- Keep each settlement linked to its underlying orders and ledger entries.
- Never hardcode a revenue split. Any example split is illustrative only.

### Delivery partner payouts
- Calculate earnings from approved delivery/fee rules.
- Track earned, reviewed, approved, processing, paid, failed, and disputed amounts.
- Link payouts to completed eligible deliveries and adjustment entries.
- Verify the recipient account before payout.

### City Admin compensation
- Model compensation as a separately approved salary, incentive, or commission policy.
- Keep calculation periods, eligibility, approvals, payout status, and references.
- The Super Admin role does not automatically mean the person receives platform revenue.

### Platform revenue and expenses
- Report earned commission/fees separately from gross order value and amounts held on behalf of sellers or partners.
- Track operating expenses and approved adjustments.
- Reconcile ledgers to verified payment and bank records.

### Approval controls
- Define maker-checker separation for high-risk actions: payment verification, refund approval, bank deposit verification, settlement approval, payout execution, role changes, and financial adjustments.
- The person who creates a financial entry must not be able to silently self-approve it where independent approval is required.
- Keep immutable audit events with actor, timestamp, action, entity, before/after values where safe, reason, and correlation/reference IDs.

---

## 11. QR codes, receipts, and printable labels

Support the following as distinct concepts:
1. **Order/delivery label QR:** identifies the order and supports authorized delivery verification.
2. **Payment QR:** used only for a supported payment flow and amount, if implemented.
3. **Receipt:** documents a recorded event such as order creation, COD collection, cash handover, bank deposit, payment, refund, or payout.

Rules:
- Never reuse one QR for unrelated security purposes.
- Never treat an order/delivery QR scan as proof of payment.
- Receipts must show the correct event, reference number, amount, date/time, and status; pending actions must be labelled pending.
- Printable delivery labels should include only the minimum customer and order information required for fulfilment.
- Receipt generation does not itself change financial status.
- For COD orders, a receipt may confirm order/collection details, but a bank deposit receipt is not proof of a verified deposit until reconciled.
- QR generation and scanning require both frontend support and server-side validation.

---

## 12. Notifications and support

- Provide in-app status feedback and, if configured, SMS/WhatsApp/email notifications for OTP, order confirmation, assignment, delivery updates, cancellation/refund status, seller approval, and payout status.
- Use only configured providers and real delivery results. Do not promise notification delivery if a provider has not confirmed it.
- Avoid exposing OTPs, secrets, bank details, or private internal notes in notifications.
- Support cases should have reference, category, order link where applicable, priority, status, assigned staff, internal notes, customer-visible replies, and resolution reason.
- Escalate payment, refund, delivery, safety, fraud, and reconciliation disputes according to a documented policy.

---

## 13. Brand and UI system

### Visual direction
- Warm, contemporary, handmade, trustworthy, and editorial—not a generic marketplace template.
- Use the approved eSakhi emblem without distorting proportions or colors.
- Brand line: **“eSakhi — Handmade with Love. Empowered by You.”**
- Palette from the current frontend plan: deep rose pink `#D6336C`, soft blush `#FDEEF0`, restrained marigold `#F7C948`, accessible neutral surfaces/text, and semantic status colors.
- Use realistic product photography and genuine SHG imagery only with permission.
- Use a consistent spacing/type scale, accessible components, restrained shadows, clear status badges, and purposeful motion.
- Support **System / Light / Dark** themes. Default to system preference until a choice is made; persist the choice on the device for the first implementation.
- Meet WCAG 2.2 AA contrast targets: at least 4.5:1 normal text and 3:1 large text and relevant non-text controls. Do not communicate status by color alone.

### Responsive layouts
- Customer storefront: mobile-first, simple shopping flow, prominent serviceability/payment information.
- Seller/partner dashboards: usable on mobile because these roles may operate in the field.
- City/Super Admin: responsive tables with mobile card alternatives, filter/search controls, pagination, bulk actions with confirmation, and clear audit context.
- Every data-backed view needs loading, empty, error, retry, mutation-pending, and confirmed-success states.

---

## 14. Technical architecture and integration requirements

### Stack and repository
- Use the existing MERN backend and add a React + TypeScript + Vite frontend if the repository audit confirms that no frontend exists.
- Keep the existing backend architecture; do not replace working code without justification.
- Use typed API functions separate from UI components.
- Use client-side routing with public/customer and role-protected layouts.
- Keep secrets on the server; frontend environment variables must not contain API keys or credentials.
- If Vite proxy is configured for local development, leave `VITE_API_BASE_URL` empty when appropriate and use the proxy. Production CORS must allow only exact approved HTTPS frontend origins through server configuration.
- Handle auth/session expiry and API error responses centrally.
- Use server-issued sessions/tokens and the existing secure cookie/session contract. Avoid storing sensitive long-lived credentials in localStorage.
- Use idempotency for checkout and financial mutations where supported.
- Validate all permissions, amounts, status transitions, stock changes, and city scope on the server.

### Data-model areas to audit/design
Final models must align with existing schemas. Likely domains include:
- User, role, permission, session
- City, service zone, serviceability rule
- SHG/seller profile and verification
- Product, inventory adjustment
- Cart (device-local initially unless durable cart is approved)
- Order, order item/address snapshots, assignment, fulfilment event
- Delivery partner profile and eligible zones
- Payment transaction and payment review
- COD collection, cash handover, bank deposit, reconciliation discrepancy
- Refund
- Seller settlement and payout
- Partner earning and payout
- City Admin compensation
- Support case and internal note
- Notification event
- Platform settings and versioned fee/commission rules
- Audit event

Do not create every proposed model blindly. First compare against the current backend, avoid duplicate concepts, document gaps, and implement the minimum correct model for the approved phase.

### API documentation
- Treat `backend/docs/API.md` and backend schema/controller validation as the current contract.
- Map every current route to a screen/action, shared session behavior, health/contract test, or explicit out-of-scope note.
- If an API contract changes, update `backend/docs/API.md`, developer documentation, validation, tests, and this PRD as necessary in the same change.
- No frontend-only implementation for security-sensitive or financial features.

---

## 15. Security, privacy, and audit

- Server-side authorization for every protected endpoint and object-level ownership check.
- Strict city/zone scoping for City Admins and local partners.
- OTP rate limits, cooldowns, expiry, attempt limits, and safe error handling.
- Validate all user input on server; protect against injection, mass assignment, insecure direct object references, and replay.
- Use secure HTTP-only cookies where the current auth design supports them, CSRF protections where required, HTTPS in production, secure headers, and restricted CORS.
- Minimize customer data visible to sellers and delivery partners.
- Mask bank and sensitive identity information except where explicitly needed.
- Never log OTPs, secrets, full payment credentials, or unnecessary personal data.
- Record sensitive actions in audit logs: role changes, seller approval, assignment/reassignment, stock adjustments, payment decisions, refunds, cash handovers, deposits, settlements, payouts, setting changes, and access/suspension changes.
- Provide session revocation and account suspension.
- Establish backup, retention, incident-response, and data-deletion policies before production.

---

## 16. Reports and analytics

### City reports
- Orders by date/status/zone
- Sales and order value (clearly labelled gross)
- Payment method and payment verification state
- Unassigned/overdue/failed deliveries
- Active sellers and stock alerts
- COD collection, handover, deposit, and reconciliation aging
- Seller settlement and partner payout obligations
- Cancellation/refund trends

### Platform reports
- City comparison and serviceability
- Gross order value vs verified collections vs refunds vs net platform revenue
- Seller liabilities, partner liabilities, City Admin compensation liabilities
- Unreconciled COD and bank deposits
- Refund and payout aging
- Operational exceptions and audit activity

Exports must respect role permissions and avoid including unnecessary personal data. Do not present estimates as verified figures.

---

## 17. External delivery providers

- Internal eSakhi delivery partners and external logistics providers are separate entities and workflows.
- Add external provider integration only after serviceability, pricing, account eligibility, pickup/drop flow, tracking, cancellation/return, insurance/liability, and reconciliation requirements are confirmed.
- Do not assume Amazon Shipping, Shiprocket, Valmo, or any provider serves a particular village/locality without current provider confirmation.
- Store external tracking/provider references and provider events separately from internal partner assignments.
- Keep local manual assignment available for the launch unless business policy changes.

---

## 18. Delivery phases

### Phase 0 — Audit and decisions
- Inspect repository, backend routes, models, middleware, tests, README, environment examples, and existing deployment assumptions.
- Verify actual existing features against this PRD and `backend/docs/API.md`.
- Produce a gap matrix: Existing / Partial / Missing / Needs business decision.
- Confirm launch city/localities, delivery pricing, seller onboarding evidence, payment policy, refund policy, fee/commission rules, payout schedule, bank account ownership, and roles.
- Do not start with a destructive rewrite.

### Phase 1 — Foundation and customer storefront
- Add React/TypeScript/Vite only if absent.
- Build brand system, routing, auth/session client, themes, API error handling, and responsive shared components.
- Implement home/story, catalogue, product detail, cart, OTP login, address management, checkout, order confirmation/history/details, and cancellation requests against existing APIs.
- Use backend-configured serviceability and payment methods.

### Phase 2 — Core admin workspace
- Implement admin dashboard, products, inventory, orders, customer views, settings, payment review, cancellation review, and internal notes according to existing API capabilities.
- Verify permissions for customer, staff, and admin roles.
- Add the endpoint coverage matrix and integration tests.

### Phase 3 — City operations, sellers, and delivery
- Add city/zone management, SHG onboarding, seller dashboard, delivery partner account creation, active/eligible assignment dropdown, assignment/reassignment, partner portal, and QR/label workflow.
- Implement backend APIs and tests before showing unsupported controls.
- Validate cross-zone eligibility and city isolation.

### Phase 4 — Financial controls
- Implement payment records, COD collection ledger, cash handover, bank remittance/deposit verification, reconciliation discrepancies, refunds, seller settlements, partner payouts, City Admin compensation, and platform revenue reporting.
- Confirm accounting/legal policy and separation of duties before live funds are processed.
- Use ledger-based transactions and audit logs; never use frontend-only balances.

### Phase 5 — External integrations and enhancements
- Add payment gateway, SMS/WhatsApp/email, secure image upload, banners/campaigns, gift cards, reviews, wishlist, persistent cart, or external delivery provider integrations only after their requirements and contracts are approved.
- Do not let optional enhancements block reliable core ordering, delivery, reconciliation, and support.

### Phase 6 — Release readiness
- Run build, typecheck, unit/integration tests, permission tests, and manual acceptance checks.
- Test desktop/tablet/mobile, keyboard/screen reader, themes, reduced motion, slow/failing API, database unavailable, expired session, out-of-stock product, invalid zone, failed payment, refund failure, duplicate webhook/mutation, failed delivery, QR replay, COD shortage, and bank reconciliation discrepancy.
- Review security, backups, logs, real product images/consent, content, policies, and production environment.
- Do not claim production readiness until the launch gates below are passed.

---

## 19. Launch acceptance criteria

### Customer
- Customers can browse only real active products and see current prices/stock.
- Customers cannot check out outside enabled service areas.
- Checkout uses server-calculated totals and current stock.
- Customers see only their own orders, addresses, and payment/refund details.
- All failures and pending states are understandable and recoverable.

### Seller
- Unapproved sellers cannot publish live products or receive orders.
- Sellers can see only their own permitted products, orders, and settlement information.
- Stock and sales changes are server-validated and audited.

### Delivery partner
- Partners see only their assigned orders and minimum necessary customer information.
- Only active, city/zone-eligible partners can be assigned.
- Partner assignment details appear consistently in order lists and details.
- QR scan cannot bypass server authorization or automatically prove payment.
- Delivery status changes follow server-defined transitions and have an audit trail.

### City Admin
- City Admins can manage only their assigned city/zone scope.
- New eligible partner accounts appear in assignment controls without unnecessary manual refresh.
- Multiple orders can be assigned to a partner when eligible.
- Assignment, reassignment, cash handling, and operational exceptions are traceable.

### Super Admin and finance
- Super Admin can manage cities/admins and see cross-city reports according to permissions.
- Gross order value is distinct from platform revenue.
- COD collection, cash handover, bank deposit, and deposit verification are separate records/states.
- Refunds, settlements, and payouts have independent approval and completion states.
- No user can silently alter a financial ledger or approve their own high-risk action where maker-checker control is required.
- All sensitive actions are audited.

### Technical and UI
- All live business data is API-driven.
- No secrets are shipped in frontend assets.
- API documentation and tests are updated with contract changes.
- UI supports responsive sizes, System/Light/Dark themes, keyboard access, readable contrast, and loading/empty/error/success states.
- No fake data, fabricated reviews, unverified coverage claims, or false success messages appear in production.

---

## 20. Business decisions still requiring explicit approval

Do not silently guess these decisions. Track them as a launch decision register.

1. **Approved service areas:** Confirm which Damoh localities are live at launch and whether any village coverage is enabled.
2. **Delivery fees and zone rules:** Fees, distance/zone eligibility, minimum order, delivery hours, pickup availability, and failed-delivery policy.
3. **Seller onboarding:** Required SHG documents, authorized representative, verification owner, and suspension/rejection appeal.
4. **Fee/commission model:** Seller share, platform commission, delivery fee, partner earning, City Admin compensation, taxes, and adjustment rules.
5. **Fund handling:** Whether COD cash goes directly to the business bank account or via City Admin, custody responsibility, deposit deadline, and independent verifier.
6. **Business/banking/legal model:** Which legal entity receives customer funds and pays sellers/partners; confirm with qualified Indian accounting/legal advisers.
7. **Payment launch:** COD and manual UPI verification details; gateway provider and eligibility only after approval.
8. **Refund/cancellation policy:** Eligibility windows, approvers, timelines, partial refunds, failed delivery, and return costs.
9. **Delivery proof:** Customer OTP, signature, photo, or another consented/appropriate confirmation; QR role and fallback process.
10. **Payout schedules:** Seller, partner, and City Admin payout frequency, minimums, hold rules, and dispute process.
11. **Support contacts and policies:** Real phone/email/WhatsApp, operating hours, privacy, terms, returns, and grievance handling.
12. **Optional features:** Decide timing for uploads, banners, promotions, gift cards, reviews, wishlist, durable cart, and external logistics providers.
13. **Notifications:** Approved SMS/OTP provider (including the previously discussed MSG1 option, if still selected), WhatsApp/email providers, templates, cost, and consent.
14. **Role structure:** Whether finance and support are separate roles or permission sets within admin accounts.

---

## 21. Repository audit checklist and implementation rules

Before writing new code:
- Inspect the root README and package scripts.
- Inspect backend route registrations, controllers, models, validation schemas, auth middleware, role checks, and tests.
- Read `backend/docs/API.md`, `.env.example`, and `backend/docs/PRD-INSTRUCTION-REVIEW.md`.
- Verify actual MongoDB connection/replica-set requirements from the existing code and README; do not assume the database is available.
- Check whether a frontend already exists before creating one.
- Map every current endpoint to a planned page/action, session service, health/contract test, or approved out-of-scope item.
- Record each feature as Existing / Partial / Missing / Blocked by decision.
- Keep working code and use small, reviewable changes.
- Add tests for each security-sensitive workflow.
- Do not commit `.env`, secrets, real customer data, or production credentials.
- Run the repository’s documented install, development, build, test, and typecheck commands after changes. If a command fails, report the exact failure and do not claim it passed.

### Environment and development
Follow the repository README and current scripts. The supplied frontend implementation plan mentions Node.js 24, npm, a configured MongoDB replica set, backend/frontend `npm ci`, a backend `.env` based on `.env.example`, and `npm run dev`, `npm run build`, `npm run test`, and `npm run typecheck`. Verify these commands against the actual repository before relying on them. For Vite proxy-based local development, keep `VITE_API_BASE_URL` empty if the proxy is intended to handle requests; production CORS should use exact approved HTTPS origins.

---

## 22. Definition of done

A dashboard is not complete just because its screens look finished. It is done only when:
1. The intended role and permissions are documented.
2. Data comes from the correct API/database source.
3. Backend authorization and object/city scope are tested.
4. Loading, empty, validation, success, and failure states exist.
5. Status transitions and business rules are enforced server-side.
6. Financial changes are ledger-backed and auditable where applicable.
7. Tests and API documentation are updated.
8. The feature is checked on mobile and desktop.
9. Unsupported integrations are clearly marked as planned, not operational.
10. Acceptance criteria are demonstrated with a non-production test dataset.

**Final implementation direction:** Start with the repository audit and gap matrix, then build in phases. Do not attempt every dashboard and financial integration in one unreviewed rewrite. Stabilize customer ordering first, then city/seller/delivery operations, then financial reconciliation and optional integrations.
