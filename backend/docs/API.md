# eSakhi Backend API

This guide documents the API implemented in `backend/src/`. It is intended for developers integrating a client, extending the service, or running the backend locally. The source code and validation schemas are authoritative if this document and the implementation ever disagree.

## Contents

- [Overview](#overview)
- [Start building locally](#start-building-locally)
- [HTTP conventions](#http-conventions)
- [Authentication](#authentication)
- [Routes and scenarios](#routes-and-scenarios)
  - [Complete endpoint index](#complete-endpoint-index)
- [Error reference](#error-reference)
- [Business workflows](#business-workflows)
- [Postman](#postman)
- [External references](#external-references)

## Overview

- **Base URL:** `http://localhost:5000` (the backend's local default)
- **API prefix:** `/api/v1`
- **Content type:** JSON (`application/json`) except product image uploads, which use `multipart/form-data`
- **Runtime:** Node.js 24, TypeScript, Express 5
- **Database:** MongoDB through Mongoose
- **Authentication:** short-lived JWT access token and rotating, HttpOnly refresh cookie
- **Currency:** integer paise (`100 paise = INR 1`)

The port is configurable with `PORT`. The default above comes from `backend/.env.example`; use the port configured in your local `.env`.

## Start building locally

### Prerequisites

- Node.js 24 LTS and npm
- MongoDB Atlas or local MongoDB configured as a **replica set**. Transactions are required for order placement, inventory reservation, cancellation, and related audit writes.
- Git and a terminal

### Install and configure

From the repository root:

```powershell
cd backend
npm ci
Copy-Item .env.example .env
```

Generate two different 64-byte random secrets, then place each 128-character hexadecimal output in `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` in `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(64).toString('hex'))"
```

Set `MONGODB_URI` to a replica-set connection string. For a local single-node replica set, start MongoDB with replica-set mode and run `rs.initiate()` once in `mongosh`. Keep credentials in `.env` or a deployment secret store; do not commit them.

For local OTP development, configure `OTP_PROVIDER=development` and a six-digit `DEV_OTP_CODE`. The code is not returned by the API or written to application logs. Production requires `OTP_PROVIDER=msg91` and the MSG91 credentials/template settings.

### Run and verify

```powershell
npm run dev
```

The server starts on `PORT` (default `5000`). Check:

```powershell
Invoke-RestMethod http://localhost:5000/health
Invoke-RestMethod http://localhost:5000/ready
```

`/health` reports process liveness and does not query MongoDB. `/ready` returns `200` only when Mongoose reports a connected database; otherwise it returns `503`.

To create the first administrator, run this from `backend/` in a trusted terminal:

```powershell
npm run admin:create -- +91XXXXXXXXXX
```

There is no public admin-registration or role-promotion endpoint. Configure the store via `PUT /api/v1/admin/settings` after provisioning an admin.

To provision a distinct Super Admin account, use the separate trusted-terminal command:

```powershell
npm run super-admin:create -- +91XXXXXXXXXX
```

This command assigns only the `super_admin` role and writes a system audit event. It does not expose a public role-assignment API or grant access by OTP registration. The Super Admin overview requires an active account with that explicit role.

To provision a City Admin account for the currently configured launch city, use the trusted-terminal command:

```powershell
npm run city-admin:create -- +91XXXXXXXXXX
```

The command scopes the account to `Settings.city`, refuses to replace a different administrative/operational role or reactivate a disabled account, and writes a system audit event. City Admin accounts cannot choose or change their own city. Authentication still uses the normal OTP flow.

After seller approval, provision the seller account from a trusted terminal:

```powershell
npm run seller:create -- +91XXXXXXXXXX
```

This command assigns the `seller` role, creates the user if needed, and writes a system audit event. It can promote an active customer account but refuses disabled accounts and accounts with any other role. Seller access is not available through public registration or OTP verification.

### Useful project commands

```powershell
npm run typecheck
npm test
npm run build
npm start
```

Configure `CLIENT_ORIGINS` with exact browser origins, for example `http://localhost:5173`. Do not use `*`. Configure `TRUST_PROXY_HOPS` to match the actual trusted proxy topology.

## HTTP conventions

### Request and authorization rules

- Send JSON request bodies with `Content-Type: application/json`; the maximum JSON body is 32 KB. The admin product image upload endpoint uses `multipart/form-data` and accepts one image up to 5 MB.
- Protected customer routes require an active account and `Authorization: Bearer <access-token>`.
- Admin routes require an active admin account unless the route says `Staff or admin`. Staff access additionally requires `staffEnabled: true` in store settings.
- Request bodies and query parameters are validated against strict schemas. Unknown fields are rejected; use the documented fields only.
- MongoDB resource IDs in path parameters must be 24-character ObjectId strings. Invalid IDs return `400 VALIDATION_ERROR` or `400 INVALID_REQUEST`, depending on the route's schema.
- Paginated lists default to `page=1` and `limit=20`; `page` must be at least 1 and `limit` must be between 1 and 100. Customer order listing accepts only `page` and `limit`. Admin order listing additionally accepts the filters documented below.
- A request from a browser origin not listed in `CLIENT_ORIGINS` is rejected with `403 CORS_ORIGIN_DENIED`. This restriction applies to browser CORS; it is not an API authentication mechanism.
- Routes that use MongoDB may return `503 DATABASE_UNAVAILABLE` if the database cannot be reached. `GET /ready` instead returns `503 NOT_READY` when Mongoose is not connected.

### Success responses

Single-resource and action responses generally have this shape:

```json
{
  "success": true,
  "data": {
    "example": "value"
  }
}
```

Paginated responses include pagination metadata alongside `data`:

```json
{
  "success": true,
  "data": [],
  "pagination": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

List endpoints default to `page=1` and `limit=20`; the maximum limit is 100.

### Error responses

Errors use a consistent envelope. Validation errors include a `fields` map where each key is a request field/path:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "fields": {
      "page": ["Too small: expected number to be >=1"]
    }
  }
}
```

Not every error includes `fields`. Do not rely on the wording of validation messages for program logic; use the HTTP status and `error.code`.

### Rate limits

- General `/api/v1` routes: 120 requests per minute per client IP. `/health` and `/ready` are exempt.
- OTP request and verify share a limit of 10 requests per 15 minutes per client IP. Refresh requests use a separate limit of 60 per 15 minutes so normal app session checks do not consume the OTP verification allowance.
- OTP requests also enforce a one-minute per-phone resend interval.

Rate-limited responses use `429 RATE_LIMIT_EXCEEDED`.

## Authentication

Protected routes require:

```http
Authorization: Bearer <accessToken>
```

Access tokens are valid for 15 minutes. Obtain one by verifying an OTP. Keep it in memory in browser clients where practical; never place a real token in source control or shared examples.

The refresh token is not returned in JSON. It is set as the `esakhi_refresh` HttpOnly cookie, scoped to `/api/v1/auth`, with `SameSite=Strict` and a seven-day default lifetime. In production it is also `Secure`. Postman clients should retain the cookie jar between verify, refresh, and logout requests.

### Roles

| Role | Access |
|---|---|
| Customer | Own profile and customer order endpoints |
| Staff | Admin dashboard, catalogue reads, order reads and fulfilment actions, and internal order notes, when staff access is enabled in settings |
| Admin | All admin APIs, including product management, customer management, payment review, settings, and inventory |
| City Admin | City-scoped dashboard, seller and delivery-partner application review, product flags, service-zone change requests, and delivery-order assignment; provisioned through the trusted CLI command |
| Super Admin | Global overview endpoint only in the initial dashboard phase; provisioned through the trusted CLI command. The existing city, seller, finance, refund, payout, support, and audit modules are not implemented. |

An authenticated user without the required role receives `403 FORBIDDEN`. A missing or invalid access token receives `401`.

## Routes and scenarios

All paths below are relative to the base URL. Unless a route is marked public, send a valid access token with the request.

### Complete endpoint index

This table lists every HTTP endpoint registered by the current backend. The detailed sections below define request fields, filters, authorization rules, and business constraints.

| Method | Path | Access | Success |
|---|---|---|---:|
| `GET` | `/` | Public | `200` |
| `GET` | `/api/v1` | Public | `200` |
| `GET` | `/health` | Public | `200` |
| `GET` | `/ready` | Public | `200` |
| `POST` | `/api/v1/auth/otp/request` | Public | `202` |
| `POST` | `/api/v1/auth/otp/verify` | Public | `200` |
| `POST` | `/api/v1/auth/refresh` | Refresh cookie | `200` |
| `POST` | `/api/v1/auth/logout` | Optional refresh cookie | `200` |
| `GET` | `/api/v1/auth/me` | Authenticated customer, staff, or admin | `200` |
| `PATCH` | `/api/v1/auth/me` | Authenticated customer, staff, or admin | `200` |
| `GET` | `/api/v1/auth/me/addresses` | Authenticated user; own addresses only | `200` |
| `POST` | `/api/v1/auth/me/addresses` | Authenticated user; own addresses only | `201` |
| `PUT` | `/api/v1/auth/me/addresses` | Authenticated customer, staff, or admin | `200` |
| `PATCH` | `/api/v1/auth/me/addresses/:addressId` | Authenticated user; own address only | `200` |
| `DELETE` | `/api/v1/auth/me/addresses/:addressId` | Authenticated user; own address only | `200` |
| `PUT` | `/api/v1/auth/me/addresses/:addressId/default` | Authenticated user; own address only | `200` |
| `GET` | `/api/v1/auth/me/address-search?q=...` | Authenticated user; 20/min in production | `200` |
| `GET` | `/api/v1/auth/me/address-reverse?latitude=...&longitude=...` | Authenticated user; 20/min in production | `200` |
| `GET` | `/api/v1/categories` | Public | `200` |
| `GET` | `/api/v1/products/categories` | Public; alias of `/api/v1/categories` | `200` |
| `GET` | `/api/v1/products` | Public | `200` |
| `GET` | `/api/v1/products/bestsellers` | Public | `200` |
| `GET` | `/api/v1/products/:slug` | Public | `200` |
| `GET` | `/api/v1/service-area` | Public | `200` |
| `POST` | `/api/v1/orders` | Authenticated customer | `201` new order; `200` idempotent replay |
| `GET` | `/api/v1/orders` | Authenticated customer; own orders only | `200` |
| `GET` | `/api/v1/orders/:id` | Authenticated customer; own order only | `200` |
| `POST` | `/api/v1/orders/:id/cancellation-requests` | Authenticated customer; own order only | `200` |
| `POST` | `/api/v1/notifications/push-token` | Authenticated customer | `201` |
| `DELETE` | `/api/v1/notifications/push-token` | Authenticated customer; own token only | `200` |
| `GET` | `/api/v1/admin/dashboard` | Admin | `200` |
| `GET` | `/api/v1/super-admin/overview` | Super Admin | `200` |
| `GET` | `/api/v1/super-admin/orders` | Super Admin | `200` |
| `GET` | `/api/v1/city-admin/dashboard` | City Admin; assigned city only | `200` |
| `GET` | `/api/v1/city-admin/service-zones` | City Admin; assigned city only | `200` |
| `POST` | `/api/v1/city-admin/service-zone-change-requests` | City Admin; assigned city only | `201` |
| `GET` | `/api/v1/city-admin/sellers` | City Admin; assigned city only | `200` |
| `GET` | `/api/v1/city-admin/products` | City Admin; assigned city only | `200` |
| `PATCH` | `/api/v1/city-admin/products/:productId/review` | City Admin; assigned city only | `200` |
| `POST` | `/api/v1/city-admin/products/:productId/flags` | City Admin; assigned city only | `201` |
| `GET` | `/api/v1/city-admin/delivery-partners` | City Admin; assigned city only | `200` |
| `GET` | `/api/v1/city-admin/delivery-partner-applications` | City Admin; assigned city only | `200` |
| `PATCH` | `/api/v1/city-admin/delivery-partner-applications/:applicationId/review` | City Admin; assigned city only | `200` |
| `GET` | `/api/v1/city-admin/orders` | City Admin; assigned city only | `200` |
| `GET` | `/api/v1/city-admin/orders/:orderId` | City Admin; assigned city only | `200` |
| `PUT` | `/api/v1/city-admin/orders/:orderId/delivery-partner` | City Admin; assigned city only | `200` |
| `POST` | `/api/v1/seller-applications` | Public | `201` new application; `200` existing pending or needs-info application |
| `GET` | `/api/v1/seller-applications` | City Admin; assigned city only | `200` |
| `PATCH` | `/api/v1/seller-applications/:applicationId/review` | City Admin; assigned city only | `200` |
| `POST` | `/api/v1/delivery-partner-applications` | Public | `201` new application; `200` existing pending or needs-info application |
| `GET` | `/api/v1/seller/dashboard` | Approved seller; own products and order items only | `200` |
| `PATCH` | `/api/v1/seller/profile` | Approved seller; edits caller's store profile | `200` |
| `GET` | `/api/v1/seller/products` | Approved seller; own products only; paginated; optional name search and approval/stock filters | `200` |
| `POST` | `/api/v1/seller/products/images` | Approved seller; validated product image upload | `201` |
| `POST` | `/api/v1/seller/products` | Approved seller; creates an unpublished listing owned by caller | `201` |
| `POST` | `/api/v1/seller/products/:productId/inventory-adjustments` | Approved seller; adjusts stock only for the seller's own non-archived product; records an inventory adjustment and audit log | `200` |
| `GET` | `/api/v1/seller/products/:productId/inventory-adjustments` | Approved seller; inventory history for caller's own product | `200` |
| `GET` | `/api/v1/seller/orders` | Approved seller; own order items only; paginated and filterable by fulfillment status | `200` |
| `GET` | `/api/v1/admin/customers` | Admin | `200` |
| `GET` | `/api/v1/admin/customers/:customerId` | Admin | `200` |
| `GET` | `/api/v1/admin/customers/:customerId/orders` | Admin | `200` |
| `PATCH` | `/api/v1/admin/users/:userId/role` | Admin | `200` |
| `PATCH` | `/api/v1/admin/users/:userId/status` | Admin | `200` |
| `GET` | `/api/v1/admin/products` | Admin, or staff when staff access is enabled | `200` |
| `POST` | `/api/v1/admin/products/images` | Admin | `201` |
| `POST` | `/api/v1/admin/products` | Admin | `201` |
| `PATCH` | `/api/v1/admin/products/:id` | Admin | `200` |
| `DELETE` | `/api/v1/admin/products/:id` | Admin; archives, does not physically delete | `200` |
| `GET` | `/api/v1/admin/orders` | Admin, or staff when staff access is enabled | `200` |
| `GET` | `/api/v1/admin/orders/:id` | Admin, or staff when staff access is enabled | `200` |
| `PATCH` | `/api/v1/admin/orders/:id/fulfilment` | Admin, or staff when staff access is enabled | `200` |
| `PUT` | `/api/v1/admin/orders/:id/delivery-partner` | Admin, or staff when staff access is enabled | `200` |
| `POST` | `/api/v1/admin/orders/delivery-partner-assignments` | Admin, or staff when staff access is enabled | `200` |
| `GET` | `/api/v1/admin/delivery-partners` | Admin | `200` |
| `GET` | `/api/v1/admin/delivery-partners/:userId` | Admin | `200` |
| `PATCH` | `/api/v1/admin/delivery-partners/:userId/status` | Admin | `200` |
| `GET` | `/api/v1/delivery-partners/orders` | Delivery partner | `200` |
| `GET` | `/api/v1/delivery-partners/orders/history` | Delivery partner | `200` |
| `PATCH` | `/api/v1/delivery-partners/orders/:id/status` | Delivery partner | `200` |
| `POST` | `/api/v1/admin/orders/:id/notes` | Admin, or staff when staff access is enabled | `200` |
| `POST` | `/api/v1/admin/orders/:id/payment-review` | Admin | `200` |
| `POST` | `/api/v1/admin/orders/:id/cancellation-review` | Admin | `200` |
| `GET` | `/api/v1/admin/notifications` | Admin | `200` |
| `POST` | `/api/v1/admin/notifications/:id/retry` | Admin | `200` |
| `GET` | `/api/v1/admin/settings` | Admin | `200` |
| `PUT` | `/api/v1/admin/settings` | Admin | `200` |
| `POST` | `/api/v1/admin/inventory/:productId/adjustments` | Admin | `200` |

The API discovery response at `GET /api/v1` advertises feature groups, not a complete route catalogue. An unmatched method/path returns `404 NOT_FOUND`.

### API discovery and health

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /` | Public | `200` | — |
| `GET /api/v1` | Public | `200` | — |
| `GET /health` | Public | `200` | — |
| `GET /ready` | Public | `200` | `503 NOT_READY` if MongoDB is not connected |

Example:

```http
GET /ready
```

```json
{
  "success": true,
  "data": {
    "status": "ready"
  }
}
```

### OTP authentication and profile

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `POST /api/v1/auth/otp/request` | Public | `202` | `400 VALIDATION_ERROR`, `429 RATE_LIMIT_EXCEEDED`, `503 OTP_PROVIDER_UNAVAILABLE` |
| `POST /api/v1/auth/otp/verify` | Public | `200` | `400 VALIDATION_ERROR` or `OTP_INVALID`, `403 ACCOUNT_DISABLED`, `429 RATE_LIMIT_EXCEEDED`, `503 OTP_PROVIDER_UNAVAILABLE` |
| `POST /api/v1/auth/refresh` | Refresh cookie | `200` | `401 UNAUTHORIZED` or `REFRESH_TOKEN_INVALID`, `429 RATE_LIMIT_EXCEEDED` |
| `POST /api/v1/auth/logout` | Optional refresh cookie | `200` | — |
| `GET /api/v1/auth/me` | Any authenticated role | `200` | `401`, `404 NOT_FOUND` |
| `PATCH /api/v1/auth/me` | Any authenticated role | `200` | `400 VALIDATION_ERROR`, `401`, `404 NOT_FOUND` |
| `GET /api/v1/auth/me/addresses` | Any authenticated role; caller's addresses only | `200` | `401`, `404 NOT_FOUND` |
| `POST /api/v1/auth/me/addresses` | Any authenticated role; caller's addresses only | `201` | `400 VALIDATION_ERROR` or `ADDRESS_LIMIT_REACHED`, `401`, `404 NOT_FOUND` |
| `PATCH /api/v1/auth/me/addresses/:addressId` | Any authenticated role; caller's address only | `200` | `400 VALIDATION_ERROR`, `401`, `404 NOT_FOUND` |
| `DELETE /api/v1/auth/me/addresses/:addressId` | Any authenticated role; caller's address only | `200` | `401`, `404 NOT_FOUND` |
| `PUT /api/v1/auth/me/addresses/:addressId/default` | Any authenticated role; caller's address only | `200` | `401`, `404 NOT_FOUND` |
| `PUT /api/v1/auth/me/addresses` | Any authenticated role; compatibility replacement endpoint | `200` | `400 VALIDATION_ERROR`, `401`, `404 NOT_FOUND` |
| `GET /api/v1/auth/me/address-search?q=...` | Any authenticated role; 20/min in production | `200` | `400 VALIDATION_ERROR`, `401`, `429 RATE_LIMIT_EXCEEDED`, `502 GEOCODING_UNAVAILABLE`, `502 GEOCODING_INVALID_RESPONSE` |
| `GET /api/v1/auth/me/address-reverse?latitude=...&longitude=...` | Any authenticated role; 20/min in production | `200` | `400 VALIDATION_ERROR`, `401`, `404 ADDRESS_NOT_FOUND`, `429 RATE_LIMIT_EXCEEDED`, `502 GEOCODING_UNAVAILABLE` |

#### Request an OTP

Indian phone numbers can be supplied as a ten-digit mobile number or in `+91` format. Spaces, parentheses, and hyphens are normalized.

```http
POST /api/v1/auth/otp/request
Content-Type: application/json
```

```json
{
  "phone": "9876543210"
}
```

Returns `202 Accepted` with a generic message. The response intentionally does not disclose whether an account exists or return an OTP.

#### Verify an OTP and start a session

```json
{
  "phone": "+919876543210",
  "code": "123456"
}
```

Successful response (`200`) includes an access token and safe user identity; the refresh cookie is set separately:

```json
{
  "success": true,
  "data": {
    "accessToken": "<access-token>",
    "user": {
      "id": "<user-id>",
      "phone": "+919876543210",
      "role": "customer"
    }
  }
}
```

Invalid, expired, already-consumed, or exhausted OTP challenges return `400 OTP_INVALID`. A disabled account returns `403 ACCOUNT_DISABLED`.

#### Refresh, logout, and profile

- `POST /api/v1/auth/refresh` rotates the refresh cookie and returns a new access token. A missing cookie returns `401 UNAUTHORIZED`; an invalid, expired, revoked, or previously rotated cookie returns `401 REFRESH_TOKEN_INVALID`.
- `POST /api/v1/auth/logout` revokes the refresh session when a valid cookie is supplied, clears the cookie, and returns `200`. It is safe to call without a cookie.
- `GET /api/v1/auth/me` returns the caller's safe profile and saved addresses in frontend format (`id`, `label`, recipient `name`/`phone`, structured address fields, optional confirmed coordinates and accuracy, `isDefault`); `email` is included when present on the account.
- `PATCH /api/v1/auth/me` accepts a strict body containing `name` (1–120 characters): `{"name":"Updated name"}`.
- `GET /api/v1/auth/me/addresses` lists only the authenticated user's saved addresses. `POST` creates an address; `PATCH` updates one address; `DELETE` removes one; and `PUT /:addressId/default` sets the sole default. All IDs are scoped to the caller's embedded user record. Up to 10 addresses are allowed, and deleting the default promotes the next saved address.
- Address fields include `label` (`Home`, `Work`, or `Other` in the UI), recipient `name` and `phone` (`+91` Indian mobile), `houseNumber`, `street`, `area`, `landmark`, `villageOrCity`, `district`, `state`, `postalCode` (six digits), service `locality`, optional `deliveryInstructions`, and optional map `latitude`, `longitude`, and `locationAccuracyMeters`. A house/building, street, or area is required; rural addresses do not need a street. Coordinates must be supplied as a pair. The server derives the formatted address instead of trusting a client-supplied string. When address components change without reconfirming a map pin, stored coordinates and accuracy are cleared.
- `PUT /api/v1/auth/me/addresses` remains as a compatibility endpoint that replaces the caller's list (maximum 10). New clients should use the per-address endpoints.
- `GET /api/v1/auth/me/address-search?q=...` and `GET /api/v1/auth/me/address-reverse?latitude=...&longitude=...` proxy Photon geocoding from the backend. Search input is 3–120 characters and coordinates must be valid WGS84 ranges. They return address suggestions; failure is explicit and must not be presented as a successful lookup. These endpoints are authenticated and rate-limited to 20 requests/minute per client IP in production (60 in development).
- Address search defaults to the public Photon instance (`GEOCODER_BASE_URL=https://photon.komoot.io`). It is reasonable-use only, can throttle traffic, and has no availability guarantee; use a self-hosted Photon instance for sustained traffic. The map uses OpenStreetMap tiles with visible attribution; its public tile servers are also best-effort and must not be bulk downloaded.

### Public catalogue and service area

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/categories` | Public | `200` | — |
| `GET /api/v1/products/categories` | Public | `200` | — |
| `GET /api/v1/products` | Public | `200` | `400 VALIDATION_ERROR` |
| `GET /api/v1/products/bestsellers` | Public | `200` | `400 VALIDATION_ERROR` |
| `GET /api/v1/products/:slug` | Public | `200` | `400 VALIDATION_ERROR`, `404 NOT_FOUND` |
| `GET /api/v1/service-area` | Public | `200` | — |

Both category endpoints return the shared six-category hierarchy with stable `categoryId` and `subcategoryId` values, display names, icons, and the product types recorded in the catalog master. The six main categories are Home and Living, Women's Apparel and Accessories, Men's Apparel and Accessories, Personal Care, Food Items, and Kids Toys & Accessories. Legacy product types such as Bangles, Jewellery, and Dupattas remain within the relevant subcategories; they are not top-level categories.

Product list query parameters:

| Parameter | Type | Meaning |
|---|---|---|
| `page` | Integer, default 1, minimum 1 | Page number |
| `limit` | Integer, default 20, range 1–100 | Page size |
| `categoryId` | Stable category slug | Optional main-category filter |
| `subcategoryId` | Stable subcategory slug | Optional subcategory filter |
| `q` | String, up to 100 characters | Optional text search |
| `sort` | `newest`, `price_asc`, or `price_desc` | Listing order; defaults to `newest` |

Public product results include category/subcategory IDs and names, `productType`, `isFoodProduct`, price in integer paise, images, stock/variants, and seller/SHG display name when available. They include only active, non-archived, approved, classified records; food products additionally require verified FSSAI compliance. Search covers product name and description. Product detail and checkout use the same publication gate. `GET /api/v1/service-area` returns `configured: false` when neither pickup nor delivery is enabled. When delivery is enabled, it returns the configured localities and six-digit postal codes. Checkout validates the locality and postal code against this configuration; it does not perform a municipal-boundary or geospatial address check.

`GET /api/v1/products/bestsellers` returns up to five products by default (set `limit` from 1 to 12). Ranking uses total units in orders with confirmed payment, excluding cancelled orders. When there are fewer ranked products than requested, the response is filled with the newest products satisfying the same approval, classification, publication, and food-compliance gates.

### Super Admin overview

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/super-admin/overview` | Active Super Admin | `200` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED` or `TOKEN_INVALID`, `403 FORBIDDEN`, `503 DATABASE_UNAVAILABLE` |
| `GET /api/v1/super-admin/orders` | Active Super Admin | `200` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED` or `TOKEN_INVALID`, `403 FORBIDDEN`, `503 DATABASE_UNAVAILABLE` |

The overview returns database-backed active-customer, active-delivery-partner and active-product counts, total and action-needed order counts, payments awaiting review, unassigned active delivery orders, low-stock product/variant counts, fulfilment-status counts, daily order counts for the requested period, and up to eight recent orders. `days` is optional and accepts 7–30 (default 30). Recent order data excludes customer contact details and internal notes. The overview's `orderValuePaise` is the sum of non-cancelled order totals and is not platform revenue, verified collections, or a finance-ledger figure.

The order directory supports `page` (default 1), `limit` (default 20, maximum 100), `q` (order reference or customer-name search), `paymentStatus`, `fulfilmentStatus`, `from`, and `to` (ISO datetimes with offsets). It returns only the order reference, customer name, delivery city, product-name snapshots, payment/fulfilment state, total, and creation time; it does not expose customer phone/address, internal notes, or payment-review notes. This route is read-only and Super Admin-only.

The response includes `generatedAt` and an `unavailableModules` list. City/zone administration, seller verification, financial ledgers, refunds, settlements/payouts, support cases, and global reports are not yet available; their counts must not be inferred from this overview.

Example response:

```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-10-28T05:30:00.000Z",
    "metrics": {
      "activeCustomers": 0,
      "activeDeliveryPartners": 0,
      "totalOrders": 0,
      "pendingPayments": 0,
      "ordersNeedingAction": 0,
      "unassignedDeliveryOrders": 0,
      "lowStockItems": 0
    },
    "ordersByFulfilmentStatus": [],
    "recentOrders": [],
    "unavailableModules": [
      "cities_and_zones",
      "city_administrators",
      "sellers_and_shgs",
      "financial_ledgers",
      "refunds",
      "settlements_and_payouts",
      "support_cases",
      "global_reports"
    ]
  }
}
```

The Super Admin role is a separate role, not an alias for the existing `admin` role. It is not assignable through customer registration, OTP verification, or the existing admin role-update endpoint. Use `npm run super-admin:create -- <phone>` from a trusted backend terminal; the operation is recorded as a system audit event.

### Customer orders

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `POST /api/v1/orders` | Customer | `201` new order; `200` idempotent replay | `400`, `401`, `403`, `409`, `503` |
| `GET /api/v1/orders` | Customer | `200` | `400 VALIDATION_ERROR`, `401` |
| `GET /api/v1/orders/:id` | Customer | `200` | `400 VALIDATION_ERROR`, `401`, `404 NOT_FOUND` |
| `POST /api/v1/orders/:id/cancellation-requests` | Customer | `200` | `400 VALIDATION_ERROR`, `401`, `409 CANCELLATION_NOT_ALLOWED` |
| `POST /api/v1/notifications/push-token` | Customer | `201` | `400 VALIDATION_ERROR`, `401`, `403`, `429 RATE_LIMIT_EXCEEDED` |
| `DELETE /api/v1/notifications/push-token` | Customer | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `429 RATE_LIMIT_EXCEEDED` |

Create-order example for pickup:

```http
POST /api/v1/orders
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "idempotencyKey": "checkout-2026-000001",
  "customerName": "Customer Name",
  "customerPhone": "+919876543210",
  "fulfilmentMethod": "pickup",
  "items": [
    {
      "productId": "<24-character-product-id>",
      "quantity": 1
    }
  ],
  "paymentMethod": "cash"
}
```

For delivery, set `fulfilmentMethod` to `delivery` and include `address` with recipient `name` and `phone`, `addressLine1` (or `houseNumber`, `street`, or `area`), `locality`, and six-digit `postalCode`. Structured fields, optional delivery instructions, and an optional confirmed coordinate pair are snapshotted into the order. The locality and postal code must match an admin-configured serviceable locality; a map pin does not bypass this check. The recipient phone may differ from the account's verified order contact. Delivery is not checked against an official municipal boundary.

Each item requires a 24-character MongoDB ObjectId `productId`, an integer `quantity` from 1 to 99, and an optional 24-character `variantId`. A product/variant can appear only once in `items`. An optional 24-character `sellerId` is accepted only for server-side validation and is ignored for routing if the product already has a persisted seller assignment; the server resolves the authoritative seller from the database. The server calculates prices, delivery fees, and totals; client-submitted prices are not accepted.

#### Checkout scenarios

| Scenario | Expected result |
|---|---|
| Valid checkout with a new idempotency key | `201`; order is created and stock reserved transactionally |
| Retry the same user's request with the same idempotency key | `200`; existing order is returned, not duplicated |
| Reuse the key with changed payload | Existing order is returned; clients should use a fresh key for a distinct checkout |
| Pickup/delivery or payment method is disabled | `400 FULFILMENT_UNAVAILABLE` or `400 PAYMENT_METHOD_UNAVAILABLE` |
| No checkout settings exist | `503 CHECKOUT_NOT_CONFIGURED` |
| Delivery address is missing or outside service area | `400 ADDRESS_REQUIRED` or `400 OUTSIDE_SERVICE_AREA` |
| Product is inactive/archived or a requested option is unavailable | `409 PRODUCT_UNAVAILABLE` or `409 VARIANT_UNAVAILABLE` |
| Stock is insufficient | `409 INSUFFICIENT_STOCK`; the transaction does not partially reserve stock |
| Requested variant is missing/invalid | `400 VARIANT_REQUIRED` or `400 VARIANT_INVALID` |

On successful checkout, payment starts at `pending_verification`; sending payment instructions or an OTP does not confirm payment. The returned order includes payment instructions appropriate to the configured payment method.

`GET /api/v1/orders` accepts `page` and `limit`, and returns only the authenticated customer's orders. Customer-facing order reads omit internal notes and payment-review history. If an order does not exist or belongs to another user, `GET /api/v1/orders/:id` returns `404` without disclosing ownership.

The order detail includes status history and, for delivery orders, the assigned delivery partner's name and phone. Internal partner notes and staff identity are not returned. Pickup orders may include the configured pickup instructions.

Cancellation is a request for review, not an immediate cancellation. Customers can request cancellation only while an order is `placed` or `accepted`, and only once. A denied request returns `409 CANCELLATION_NOT_ALLOWED`.

### Admin dashboard and customer management

All routes in this section require an admin access token.

| Method and path | Success | Other expected outcomes |
|---|---:|---|
| `GET /api/v1/admin/dashboard` | `200` | `401`, `403` |
| `GET /api/v1/admin/customers` | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `GET /api/v1/admin/customers/:customerId` | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `GET /api/v1/admin/customers/:customerId/orders` | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `PATCH /api/v1/admin/users/:userId/role` | `200` | `400 VALIDATION_ERROR` or `INVALID_REQUEST`, `401`, `403`, `404 NOT_FOUND` |
| `PATCH /api/v1/admin/users/:userId/status` | `200` | `400 VALIDATION_ERROR` or `INVALID_REQUEST`, `401`, `403`, `404 NOT_FOUND` |

Customer list and customer-order list accept `page` and `limit` (default `1` and `20`, maximum `100`). `GET /admin/customers/:customerId/orders` returns an empty page if no orders match that ID.

Role update body:

```json
{
  "role": "staff"
}
```

`customer`, `staff`, `seller`, and `delivery_partner` are accepted; this endpoint cannot grant the `admin`, `city_admin`, or `super_admin` role. An admin cannot change their own role (`400 INVALID_REQUEST`). Seller access should be granted only after the seller application has completed the required review and approval. Role changes are recorded in the audit log.

### Seller workspace

All seller workspace routes require an authenticated `seller` role. Products and order items are scoped to the authenticated user ID stored as `sellerId`; order responses include only that seller's items and subtotal and omit customer contact/address details and other sellers' items. Sellers can edit approved store-profile fields, upload and submit unpublished product listings, and adjust stock for their own products. Food listings require a verified FSSAI workflow and all new products remain unpublished until City Admin approval.

`POST /api/v1/seller-applications` accepts `shgName`, `representative`, `phone`, `city`, `address`, `categoryId`, `subcategoryId`, and `productType`. Indian mobile numbers may be sent as ten digits or E.164 with `+91`; the API normalizes them and rejects invalid numbers. Category IDs must identify a valid shared category/subcategory pair. Food applications must also include a 14-digit `fssaiRegistrationNumber`; non-food applications must not include it. New applications are stored with `pending` status. Repeated submissions for the same phone and city while an application is pending or needs information return the existing status without creating another record. An application is not seller access.

Expected submission errors are `400 VALIDATION_ERROR` for invalid fields and `429 RATE_LIMIT_EXCEEDED` when the API rate limit is reached.

City Admin list and review operations always filter by the authenticated account's assigned city. The list accepts `page`, `limit`, and optional `status` (`pending`, `approved`, `rejected`, or `needs_info`). Review accepts `decision` (`approved`, `rejected`, or `needs_info`) and an optional note. Approving a food application additionally requires `fssaiDecision: "verified"`; this is an explicit City Admin attestation and the submitted registration number must be present. Approving an application creates or promotes an active customer account for the submitted phone to the `seller` role; disabled or other-role accounts cannot be promoted. Review decisions and account provisioning are transactional and audited. Approved applicants sign in using OTP for the submitted phone number. Food seller product creation and product publication both recheck that the seller application is approved and FSSAI-verified.

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/seller/dashboard` | Seller | `200` | `401`, `403` |
| `PATCH /api/v1/seller/profile` | Seller | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 SELLER_PROFILE_NOT_FOUND` |
| `GET /api/v1/seller/products` | Seller | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `POST /api/v1/seller/products/images` | Seller | `201` | `400 IMAGE_REQUIRED`, `400 INVALID_IMAGE`, `400 UNSUPPORTED_IMAGE_TYPE`, `401`, `403`, `413` |
| `POST /api/v1/seller/products` | Seller | `201` | `400 VALIDATION_ERROR`, `401`, `403`, `409 FSSAI_VERIFICATION_REQUIRED` |
| `POST /api/v1/seller/products/:productId/inventory-adjustments` | Seller | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `409 INVENTORY_UPDATE_FAILED` |
| `GET /api/v1/seller/products/:productId/inventory-adjustments` | Seller; own product only | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `GET /api/v1/seller/orders` | Seller | `200` | `400 VALIDATION_ERROR`, `401`, `403` |

The dashboard returns the approved seller profile, seller-owned product/order metrics, confirmed paid product-sales trend, top-selling products, and low-stock products. Sales are gross product-item sales and are not a settlement or payout amount. Reviews, settlement balances, commission calculations, and payment history are not currently tracked and are not represented as available seller funds.

Seller profile updates accept `shgName`, `representative`, `registeredAddress`, and `storeDescription`. Phone, email, assigned city, serviceable localities, category selection, and FSSAI review state are read-only to sellers; location changes must be requested through the platform.

Seller product listing accepts `page`, `limit`, optional `q` (literal product-name search), optional `approvalStatus`, and optional `stockStatus` (`all`, `low_stock`, `out_of_stock`, `in_stock`). It returns only the caller's non-archived products. The product image upload accepts one JPEG, PNG, or WebP image up to 5 MiB using multipart field `image`. Seller inventory adjustment accepts `quantityChange` (non-zero integer from -100,000 to 100,000), `reason` (3–300 characters), and optional `variantId`; a negative adjustment cannot reduce stock below zero. The product, inventory adjustment record, and audit log are updated transactionally, and products owned by another seller are not accessible through this endpoint. Inventory history is seller- and product-scoped.

Seller product creation accepts `name`, `slug`, `description`, `categoryId`, `subcategoryId`, `productType`, `pricePaise`, optional `imageUrls`, `stock`, and `lowStockThreshold`. The server derives hierarchy display names and the food flag from the shared category master. New listings are always unpublished and pending City Admin approval. Food listings require an approved seller application with verified FSSAI details. Seller submissions whose product type is not in the mapped product master remain marked `needs_review` until the City Admin classifies them. Seller order results accept `page`, `limit`, and `status` (`all`, `new`, `processing`, `ready`, `completed`, or `cancelled`). Seller-side fulfilment transitions, settlement/payout calculations, and customer reviews are not implemented.

### City Admin dashboard and order directory

| Method and path | Auth | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/city-admin/dashboard` | Active City Admin with an assigned city | `200` | `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED`, `503 DATABASE_UNAVAILABLE` |
| `GET /api/v1/city-admin/service-zones` | Active City Admin with an assigned city | `200` | `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `POST /api/v1/city-admin/service-zone-change-requests` | Active City Admin with an assigned city | `201` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `GET /api/v1/city-admin/sellers` | Active City Admin with an assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `GET /api/v1/city-admin/products` | Active City Admin with an assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `PATCH /api/v1/city-admin/products/:productId/review` | Active City Admin; product seller belongs to assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409 PRODUCT_CLASSIFICATION_REQUIRED` or `FSSAI_VERIFICATION_REQUIRED` |
| `POST /api/v1/city-admin/products/:productId/flags` | Active City Admin; product seller belongs to assigned city | `201` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `GET /api/v1/city-admin/delivery-partners` | Active City Admin; own city only | `200` | `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `GET /api/v1/city-admin/delivery-partner-applications` | Active City Admin; own city only | `200` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `PATCH /api/v1/city-admin/delivery-partner-applications/:applicationId/review` | Active City Admin; own city only | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409` role, city, or locality conflict |
| `GET /api/v1/city-admin/orders` | Active City Admin with an assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED`, `503 DATABASE_UNAVAILABLE` |
| `GET /api/v1/city-admin/orders/:orderId` | Active City Admin; order address city must match assigned city | `200` | `401`, `403`, `404 NOT_FOUND` |
| `PUT /api/v1/city-admin/orders/:orderId/delivery-partner` | Active City Admin; order and approved partner must match assigned city and locality | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404`, `409` assignment or eligibility conflict |
| `GET /api/v1/seller-applications` | Active City Admin with an assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403 FORBIDDEN` or `CITY_SCOPE_REQUIRED` |
| `PATCH /api/v1/seller-applications/:applicationId/review` | Active City Admin with an assigned city | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409` review or account conflict |

The dashboard uses only orders whose delivery address city matches the server-side `assignedCity`. Today's counts and status breakdown use India Standard Time calendar-day boundaries; the seven-day trend includes today and the six preceding city-local days. The response includes today's order count, seller applications awaiting review for the assigned city, delivery orders awaiting assignment, orders out for delivery, orders delivered today, orders needing fulfilment action, payments awaiting review, per-fulfilment-status counts, recent orders, and unassigned delivery orders. The current schema does not record city ownership for inventory, delivery partners, partner applications, or support cases, so those dashboard metrics are explicitly unavailable and no cross-city data is substituted.

Seller application reviews are city-scoped separately: the City Admin list and review endpoints only expose records whose application city matches the assigned city. Approvals provision seller-role access and write audit entries; rejection and requests for more information update the application status without granting access.

`GET /api/v1/city-admin/service-zones` returns the configured locality/PIN-code records and delivery fees only when the global configured city matches the caller's assigned city. It also reports active delivery-order counts by locality. The current schema does not record partner eligibility by locality, so eligible partner counts are explicitly untracked. When the global city does not match the caller's assigned city, the response contains no zone records. City Admins cannot edit global serviceability settings.

`POST /api/v1/city-admin/service-zone-change-requests` accepts `requestText` (10–1000 characters), stores a pending request against the authenticated City Admin's assigned city, and writes an audit event. It does not change serviceability settings. A corresponding Super Admin review workflow is not yet implemented.

`GET /api/v1/city-admin/sellers` accepts `page`, `limit`, and `q` (seller name or phone). Results only include seller accounts whose `assignedCity` matches the authenticated City Admin's city. Product counts/categories and order counts are derived from seller-linked records. Identity/group verification is not modeled and is returned as `not_tracked`.

`GET /api/v1/city-admin/products` accepts `page`, `limit`, `q`, `categoryId`, `subcategoryId`, `approvalStatus`, `sellerId`, `stockStatus` (`all`, `low_stock`, `out_of_stock`), and `listingStatus` (`all`, `active`, `inactive`, `archived`). Results are restricted to products whose seller is assigned to the caller's city. Available stock reflects current product/variant stock after reservations. `reservedStock` is derived from unexpired, unconfirmed orders in `placed` or `accepted`; other allocation states are not tracked separately. The response includes category hierarchy, classification, FSSAI status, and approval state. Product review accepts `decision` (`approved` or `rejected`), an optional note (required to reject), and optionally all three of `categoryId`, `subcategoryId`, and `productType` to resolve or correct classification. Approval requires a valid classification; food classification/approval requires an approved seller application with verified FSSAI details. Review writes an audit event. `POST /api/v1/city-admin/products/:productId/flags` accepts a 10–1000 character `reason`, records a city-scoped open flag, and writes an audit event without changing the product.

`POST /api/v1/delivery-partner-applications` accepts a name, Indian mobile number, city, one or more requested localities, and an optional note. City Admin review is restricted to their assigned city. Approval is allowed only when the city matches configured service settings, requested localities exist in that city's configured serviceable locality list, and the phone is not a disabled or conflicting-role account. Approval provisions an active delivery partner with `assignedCity` and `serviceableLocalities`; rejection requires a reason. These assignments are audited. `GET /api/v1/city-admin/delivery-partners` only lists partner accounts assigned to that city. Availability and identity verification are not tracked.

City Admin order assignment uses the existing allowed status transitions: new assignment only for an unassigned eligible delivery order, and reassignment only after `delivery_failed`. The partner must be active, assigned to the same city, and have the order's locality in their approved `serviceableLocalities`. Reassignment requires a reason, which is stored in assignment history and audit metadata. Out-of-city orders are not returned by City Admin order detail or assignment routes.

The order directory supports `page` (default 1), `limit` (default 20, maximum 100), `q` (order reference or customer-name search), `fulfilmentStatus`, `paymentStatus`, and `unassignedOnly=true`. Every result is constrained to the authenticated user's assigned city, regardless of query parameters. Responses omit phone numbers, street addresses, delivery instructions, internal notes, and review notes. These endpoints are read-only; assignment mutations and finance/support operations are not yet available to City Admins.

Status update body:

```json
{
  "status": "disabled"
}
```

Disabling an account revokes its refresh session. An admin cannot disable their own account (`400 INVALID_REQUEST`).

### Admin catalogue

Admin and enabled staff can read the admin catalogue. Product creation, update, and archive require an admin.

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/admin/products` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `POST /api/v1/admin/products/images` | Admin | `201` | `400 IMAGE_REQUIRED`, `400 INVALID_IMAGE`, `400 UNSUPPORTED_IMAGE_TYPE`, `401`, `403`, `413 PAYLOAD_TOO_LARGE` |
| `POST /api/v1/admin/products` | Admin | `201` | `400 VALIDATION_ERROR`, `401`, `403`, `409 CONFLICT` |
| `PATCH /api/v1/admin/products/:id` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409 CONFLICT` |
| `DELETE /api/v1/admin/products/:id` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |

Admin product listing accepts `page`, `limit`, `categoryId`, `subcategoryId`, `q`, and optional `active`/`archived` values (`true` or `false`). Product creation accepts:

Upload each product image before creating or updating a product:

```http
POST /api/v1/admin/products/images
Authorization: Bearer <access-token>
Content-Type: multipart/form-data
```

Send one file in the `image` field. JPEG, PNG, and WebP images up to 5 MB are accepted. The response returns an `imageUrl` path to include in the product's `imageUrls` array. Uploaded files are served publicly at that path.

```json
{
  "name": "Handmade bangles",
  "slug": "handmade-bangles",
  "description": "Product description",
  "categoryId": "womens-apparel-accessories",
  "subcategoryId": "jewellery-accessories",
  "productType": "Bangles",
  "pricePaise": 15000,
  "imageUrls": ["/uploads/product-images/123e4567-e89b-42d3-a456-426614174000.jpg"],
  "stock": 5,
  "lowStockThreshold": 2,
  "variants": [],
  "isActive": false
}
```

Important validation rules:

- Category and subcategory IDs must be a valid pair from the shared category master. Display names are derived by the API.
- Food products are detected from the category master. An active food product requires an approved seller application with verified FSSAI details.
- `pricePaise` must be an integer from 1 to 100,000,000.
- Product image entries must be HTTPS URLs or paths returned by the image upload endpoint; maximum 10.
- Slugs must be lowercase letters/numbers separated by single hyphens.
- If variants are configured, top-level `stock` must be zero; each variant has its own stock.
- Creation defaults `isActive` to false. Product updates cannot modify stock; use inventory adjustments instead.
- A duplicate unique slug produces `409 CONFLICT`.

`DELETE` archives the product (`isArchived=true`, `isActive=false`); it does not physically delete the record.

### Admin orders and fulfilment

Staff with staff access enabled and admins can use these routes. Payment review and cancellation review require an admin.

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/admin/orders` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `GET /api/v1/admin/orders/:id` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `PATCH /api/v1/admin/orders/:id/fulfilment` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION` |
| `PUT /api/v1/admin/orders/:id/delivery-partner` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 DELIVERY_PARTNER_NOT_FOUND`, `409 DELIVERY_PARTNER_NOT_ALLOWED` |
| `POST /api/v1/admin/orders/delivery-partner-assignments` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 DELIVERY_PARTNER_NOT_FOUND`, `409 DELIVERY_PARTNER_NOT_ALLOWED` |
| `GET /api/v1/admin/delivery-partners` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `GET /api/v1/admin/delivery-partners/:userId` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `PATCH /api/v1/admin/delivery-partners/:userId/status` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `GET /api/v1/delivery-partners/orders` | Delivery partner | `200` | `401`, `403` |
| `GET /api/v1/delivery-partners/orders/history` | Delivery partner | `200` | `401`, `403` |
| `PATCH /api/v1/delivery-partners/orders/:id/status` | Delivery partner | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND`, `409 INVALID_STATUS_TRANSITION` |
| `POST /api/v1/admin/orders/:id/notes` | Staff | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `404 NOT_FOUND` |
| `POST /api/v1/admin/orders/:id/payment-review` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `409 PAYMENT_ALREADY_REVIEWED` |
| `POST /api/v1/admin/orders/:id/cancellation-review` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `409` cancellation-related errors |

`GET /admin/orders` accepts `page`, `limit`, `q`, `paymentStatus`, `fulfilmentStatus`, `cancellationRequest`, `from`, and `to`. Set `cancellationRequest=pending` to list unreviewed requests, or `reviewed` to list requests with a decision. Dates must be ISO-8601 timestamps with timezone offsets; `from` must not be later than `to`.

`GET /api/v1/delivery-partners/orders` returns only non-terminal orders assigned to the authenticated partner. `GET /api/v1/delivery-partners/orders/history` returns up to 100 terminal orders currently or previously assigned to that partner (`delivered`, `completed`, `delivery_failed`, or `cancelled`), newest first. Delivery partners can update only orders assigned to their own account, with allowed transitions `preparing|ready_for_pickup → out_for_delivery → delivered|delivery_failed`. Updates are audited and may include a partner note.

Fulfilment update body:

```json
{
  "status": "accepted"
}
```

Valid transitions are conditional on fulfilment method:

- Both methods: `placed → accepted → preparing`
- Pickup: `preparing → ready_for_pickup → completed`
- Delivery: `preparing → out_for_delivery → delivered`

Invalid transitions return `409 INVALID_STATUS_TRANSITION`. A delivery partner must be assigned before a delivery order can move to `out_for_delivery` (`409 DELIVERY_PARTNER_REQUIRED`). Staff may add an internal note with `{"note":"Contacted customer"}`; internal notes are excluded from customer order reads.

Assign an existing delivery-partner account to an unassigned delivery order while it is `preparing` or `out_for_delivery`:

```http
PUT /api/v1/admin/orders/<order-id>/delivery-partner
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "partnerId": "<delivery-partner-user-id>",
  "internalNotes": "Optional internal note"
}
```

The account must have the `delivery_partner` role and be active. An assigned order cannot be assigned again while fulfilment is in progress. Once the delivery partner reports `delivery_failed`, the order can be reassigned; reassignment records the previous assignment in `deliveryPartnerHistory`, resets fulfilment to `preparing`, and adds that transition to `statusHistory`. The order then appears as active for the newly assigned partner and no longer appears in the former partner's active portal list. Legacy/manual assignment bodies containing `name` and `phone` remain supported for existing workflows and records; mobile numbers may be ten digits or `+91` plus ten digits.

For bulk assignment, send one to 100 eligible order IDs and an active partner account:

```http
POST /api/v1/admin/orders/delivery-partner-assignments
Authorization: Bearer <access-token>
Content-Type: application/json
```

```json
{
  "partnerId": "<delivery-partner-user-id>",
  "orderIds": ["<order-id-a>", "<order-id-b>"]
}
```

The bulk request is atomic: all orders must be unassigned delivery orders in `preparing` or `out_for_delivery`, or delivery orders in `delivery_failed`; otherwise the request returns `409 DELIVERY_PARTNER_NOT_ALLOWED` and no assignments are saved. Failed orders reset to `preparing` when reassigned. Account assignment does not create a partner account. Existing legacy assignments remain readable; when replaced after a failed attempt, their available snapshot details are appended to assignment history.

The admin partner directory returns account identity, optional email, account status, and count of currently active assigned orders. Partner details include that account's assigned orders. The partner portal lists only active orders whose persisted `deliveryPartner.userId` matches the authenticated account; completed, cancelled, and failed attempts are removed from the active list. It excludes staff-only fields and permits status changes only along the assigned-order delivery transitions (`preparing`/`ready_for_pickup` → `out_for_delivery` → `delivered` or `delivery_failed`).

Payment review body:

```json
{
  "status": "confirmed",
  "note": "Payment verified"
}
```

`status` must be `confirmed` or `rejected`; `note` is required (1–1000 characters). Only pending, non-cancelled payments can be reviewed. A repeated or otherwise ineligible review returns `409 PAYMENT_ALREADY_REVIEWED`.

Cancellation review body:

```json
{
  "decision": "rejected",
  "note": "Optional explanation"
}
```

`decision` must be `approved` or `rejected`; `note` is optional (maximum 500 characters). Approval is limited to orders in `placed` or `accepted`. Confirmed-payment orders cannot be cancelled until a refund policy is configured (`409 REFUND_POLICY_UNCONFIGURED`). An approved cancellation restores reserved stock within the transaction.

The admin Orders page displays request state and provides a pending-request filter. Open an order to review the customer's note, optionally enter a response note, then approve or decline. Payment review is available on the admin order detail for `pending_verification` orders: enter a required audit note and choose **Confirm received payment** or **Mark payment rejected**. Payment review is one-time; its result and note are retained in the order's payment review history. Customer order detail refreshes automatically every 30 seconds and when the page regains focus so fulfilment and cancellation decisions appear without a manual refresh.

### Push notifications

Push notifications are optional. Customer devices register and remove their own Firebase Cloud Messaging token using these routes:

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `POST /api/v1/notifications/push-token` | Customer | `201` | `400 VALIDATION_ERROR`, `401`, `403`, `429 RATE_LIMIT_EXCEEDED` |
| `DELETE /api/v1/notifications/push-token` | Customer | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `429 RATE_LIMIT_EXCEEDED` |

Both routes accept `{"token":"<Firebase registration token>"}`. Token strings must contain 20–4096 characters; requests are limited to 20 changes per hour per client. Registration returns only `{"registered":true}` and removal only `{"removed":true}`.

When configured, order status changes enqueue one event per active device token within the same transaction as the order update. The background worker sends notifications asynchronously, retries transient failures up to five attempts, and deactivates invalid tokens. If Firebase Admin is not configured, the worker does not send notifications.

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/admin/notifications?page=1&limit=20` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `POST /api/v1/admin/notifications/:id/retry` | Admin | `200` | `401`, `403`, `404 NOTIFICATION_NOT_FOUND`, `409 PUSH_TOKEN_UNAVAILABLE` |

The admin list contains failed-event metadata only; it never returns FCM tokens or customer contact details. A retry resets an eligible failed event to pending. Retry delivery requires that the device token remains active.

### Admin settings and inventory

| Method and path | Minimum role | Success | Other expected outcomes |
|---|---|---:|---|
| `GET /api/v1/admin/settings` | Admin | `200` | `401`, `403` |
| `PUT /api/v1/admin/settings` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403` |
| `POST /api/v1/admin/inventory/:productId/adjustments` | Admin | `200` | `400 VALIDATION_ERROR`, `401`, `403`, `409 INVENTORY_UPDATE_FAILED` |

Before the first settings update, `GET /admin/settings` succeeds with `data: null`.

`PUT /admin/settings` replaces the settings contract and requires these fields. Admins can enable delivery once they configure at least one serviceable locality, its six-digit postal code(s), and a delivery fee. The API does not verify that configuration against an official municipal boundary.

```json
{
  "businessName": "eSakhi",
  "city": "Damoh",
  "state": "Madhya Pradesh",
  "serviceableLocalities": [
    {
      "name": "Damoh",
      "postalCodes": ["470661"],
      "deliveryFeePaise": 0
    }
  ],
  "pickupEnabled": false,
  "deliveryEnabled": false,
  "staffEnabled": false,
  "upiEnabled": false,
  "cashEnabled": false,
  "stockReservationHours": null,
  "policies": {},
  "lowStockThreshold": 5
}
```

Optional fields include `phone`, `whatsapp`, `address`, `upiId`, `upiQrUrl`, `upiInstructions`, `cashInstructions`, and `pickupInstructions`. The request is strict: unknown fields are rejected.

Settings constraints include:

- When delivery is enabled, configure at least one locality and a delivery fee for every locality.
- A postal code can belong to only one locality.
- When UPI is enabled, provide both `upiId` and `upiInstructions`.
- When cash is enabled, provide `cashInstructions`.
- `stockReservationHours` is `null` for manual/admin-controlled reservations, or an integer from 1 through 720 for automatic expiry.
- Fees and monetary values are integer paise.

Inventory adjustment body:

```json
{
  "quantityChange": 5,
  "reason": "Restock",
  "variantId": "<optional-24-character-variant-id>"
}
```

`quantityChange` must be a non-zero integer from -100,000 through 100,000. A negative adjustment cannot reduce stock below zero. Product/variant not found or insufficient stock returns `409 INVENTORY_UPDATE_FAILED`. The product update, inventory adjustment record, and audit event are transactional.

## Error reference

| HTTP | Error code(s) | Meaning and typical action |
|---:|---|---|
| `400` | `VALIDATION_ERROR` | Request body, query, or route parameter failed schema validation. Check `error.fields`. |
| `400` | `INVALID_REQUEST` | Malformed JSON, invalid identifier, or a forbidden self-role/status operation. |
| `400` | `OTP_INVALID` | OTP is invalid, expired, already consumed, or has exceeded attempts. Request a new code when allowed. |
| `400` | `PHONE_MISMATCH`, `FULFILMENT_UNAVAILABLE`, `PAYMENT_METHOD_UNAVAILABLE`, `ADDRESS_REQUIRED`, `OUTSIDE_SERVICE_AREA`, `INVALID_TOTAL`, `VARIANT_REQUIRED`, `VARIANT_INVALID` | Checkout or product-option business rule failed. Correct input or configuration. |
| `401` | `UNAUTHORIZED` | Credentials are missing or the account/session is unavailable. |
| `401` | `TOKEN_EXPIRED` | Access token expired; use the refresh endpoint if the cookie is valid. |
| `401` | `TOKEN_INVALID` | Access token is malformed or invalid; authenticate again. |
| `401` | `REFRESH_TOKEN_INVALID` | Refresh cookie is invalid, expired, revoked, or already rotated; authenticate again. |
| `403` | `FORBIDDEN` | User role does not permit the operation, or staff access is disabled. |
| `403` | `ACCOUNT_DISABLED` | Account is disabled and cannot start/use the session. |
| `403` | `CORS_ORIGIN_DENIED` | Browser origin is not listed in `CLIENT_ORIGINS`. |
| `404` | `NOT_FOUND` | Resource is absent or, for customer-owned reads, not visible to the caller. |
| `409` | `CONFLICT` | Unique value already exists, such as a duplicate product slug. |
| `409` | `INSUFFICIENT_STOCK`, `PRODUCT_UNAVAILABLE`, `VARIANT_UNAVAILABLE` | Checkout could not reserve the requested product/option. |
| `409` | `INVALID_STATUS_TRANSITION` | Requested order fulfilment transition is not allowed or order changed concurrently. Reload current state. |
| `409` | `CANCELLATION_NOT_ALLOWED`, `CANCELLATION_ALREADY_REVIEWED`, `CANCELLATION_NOT_FOUND`, `REFUND_POLICY_UNCONFIGURED` | Cancellation is unavailable, already reviewed, missing, or blocked by the refund policy. |
| `409` | `PAYMENT_ALREADY_REVIEWED` | Payment is no longer awaiting verification. |
| `409` | `INVENTORY_UPDATE_FAILED`, `INVENTORY_RESTORE_FAILED` | Inventory could not be adjusted/restored; inspect the current product/order state before retrying. |
| `413` | `PAYLOAD_TOO_LARGE` | Request JSON body exceeds the 32 KB limit. |
| `429` | `RATE_LIMIT_EXCEEDED` | Rate limit reached. Wait before retrying. |
| `500` | `INTERNAL_ERROR` | Unexpected or failed server operation. Do not retry non-idempotent actions blindly; inspect server logs. |
| `503` | `NOT_READY` | MongoDB connection is not ready. |
| `503` | `DATABASE_UNAVAILABLE` | A request could not reach MongoDB. Retry after the database is available. |
| `503` | `CHECKOUT_NOT_CONFIGURED` | Checkout settings or locality delivery pricing are incomplete. |
| `503` | `OTP_PROVIDER_UNAVAILABLE` | OTP provider is unavailable or returned an unusable response. Retry later. |

The rate-limit middleware also returns `429 RATE_LIMIT_EXCEEDED`. Treat other codes not listed for a particular endpoint as unexpected and inspect logs/implementation before relying on them.
An unmatched route returns `404` with `error.code: "NOT_FOUND"`.
Routes that query or update MongoDB can also return `503 DATABASE_UNAVAILABLE` when the database is temporarily unreachable.

## Business workflows

### Customer sign-in

1. `POST /auth/otp/request` with the customer's phone.
2. `POST /auth/otp/verify` with the phone and six-digit code.
3. Store the returned access token for protected requests; allow Postman/browser cookie handling to retain `esakhi_refresh`.
4. When access token expires, call `POST /auth/refresh`; if refresh fails, sign in again.
5. Call `POST /auth/logout` to revoke the refresh session.

### Store setup

1. Provision the first admin using the CLI.
2. Sign in as that admin.
3. `PUT /admin/settings` with complete, business-approved location, payment, and fulfilment settings.
4. Keep pickup/delivery and payment methods disabled until their real instructions/fees are configured.

### Checkout and fulfilment

1. Read public products and service-area configuration.
2. Submit a unique idempotency key with the order request.
3. The backend validates account, settings, selected product/options, serviceability, stock, and prices in a transaction.
4. Admin/staff progresses the order only through the supported fulfilment transitions.
5. Admin records payment verification separately; payment instructions do not equal payment confirmation.
6. Customer cancellation requests require review. Approval restores inventory transactionally, subject to the configured refund policy.

### Operational behaviors and limitations

- Order creation, stock reservation, cancellation review, inventory changes, and their audit writes use MongoDB transactions. A standalone MongoDB instance is not sufficient; use a replica set or a supported sharded deployment.
- Reservation cleanup runs in the API process every minute when `stockReservationHours` is configured. Deployments with multiple API instances should consider worker coordination before scaling.
- OTP request and verify codes are never included in API responses or application logs.
- Product images can be uploaded by an admin as JPEG, PNG, or WebP files up to 5 MB each. The backend stores them in `backend/uploads/product-images/`; deployments must mount persistent storage at that directory so images survive restarts and releases. Payment-proof uploads are not implemented.
- Payments are reconciled manually by an authorized admin; payment gateways, refunds, and analytics integrations are not implemented. Optional push notifications require Firebase configuration as described in the backend README.
- The in-memory rate-limit store is intended for a single process; configure a shared store before running multiple API instances.

## Postman

Import the requests in `backend/postman/eSakhi Backend API/` or use the category-wise eSakhi collection available in the connected Postman workspace. Set `baseUrl` to the backend origin (for example `http://localhost:5000`), not the `/api/v1` prefix. Keep the cookie jar enabled for OTP refresh/logout. Set `accessToken` after verifying an OTP before calling protected routes.

The category-wise collection includes response tests for each request's documented status-code set and the standard success/error JSON envelope. Those checks do not replace integration testing of database mutations. Use placeholder values in shared collections. Do not save real OTPs, access tokens, customer data, or database credentials in collection variables or committed environment files.

## External references

These official references provide background on the framework and tooling used here. They do not supersede the endpoint behavior documented from this repository's source.

- [Express 5 error handling](https://expressjs.com/en/guide/error-handling.html) — asynchronous errors and middleware error handling.
- [Mongoose connections](https://mongoosejs.com/docs/connections.html) — connection lifecycle, options, and errors.
- [MongoDB transactions](https://www.mongodb.com/docs/manual/core/transactions/) — transaction behavior and deployment considerations.
- [Postman collections overview](https://learning.postman.com/docs/use/use-collections/overview/) — organizing and sharing request collections.
- [Postman collection schema](https://schema.postman.com/) — machine-readable collection format.
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases) — supported and LTS release lines.
- [MSG91 OTP API](https://docs.msg91.com/otp/sendotp) — provider reference used for the optional production OTP integration.
