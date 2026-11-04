# eSakhi frontend

React, TypeScript, and Vite customer storefront and admin workspace.

## Run locally

From the repository root, install dependencies and start both the backend and frontend:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm run dev
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). API and image requests go through the Vite proxy, which removes the browser's `Origin` header before forwarding requests to the backend. This avoids development CORS errors even when opening the frontend from another device on the same network. Leave `VITE_API_BASE_URL` empty when using this proxy. If you configure it to call the backend directly, configure the backend's `CLIENT_ORIGINS` with the exact frontend origin.

Run the production type-check and build with:

```powershell
npm run build
npm run preview
```

## Current integration

The frontend has customer flows for OTP sign-in, product discovery, cart, checkout, profile, saved addresses, order history, and optional order push notifications. Address entry supports browser GPS (only after the user asks), map pin adjustment, manual entry and Photon address suggestions. The protected workspace includes dashboard, product management, inventory, orders, customers, settings, and non-mutating API checks. The endpoint map in the root `plan.md` tracks backend routes.

Admin accounts must be provisioned securely through the backend's `npm run admin:create` command; customer self-registration never grants admin access. Admins can upload product images from the product editor. Gift-card and promotional-banner/carousel management are not available in the backend and are not presented as active frontend features.

The current Maitri Sisterhood logo is stored at `public/images/maitri-sisterhood-logo.png`. Admins can upload up to 10 JPEG, PNG, or WebP product images (5 MB each) from the product editor. The backend stores those images in its `uploads/product-images/` directory, which must use persistent storage for deployed environments. Real product and maker photographs, business-approved copy, service area, and payment configuration should be supplied by the business; the interface does not invent catalogue or operational records.

The customer shop, seller application/listing forms, and City Admin product review all load the same category hierarchy from `GET /api/v1/categories`. Product listings are submitted to the backend and remain unpublished until approval; food sellers additionally require verified FSSAI details. The workbook's 157 rows describe product types, not live SKUs, so the frontend does not seed products, prices, stock, or seller names from it.

To enable web push, configure the `VITE_FIREBASE_*` public web-app values and `VITE_FIREBASE_VAPID_KEY` in `.env`; configure `FIREBASE_SERVICE_ACCOUNT_JSON` only on the backend. Push delivery is optional and requires user permission and a supported browser secure context (localhost or HTTPS).

Maps use OpenStreetMap tiles and the Photon geocoder through the backend. No browser map key or billing account is required. Set `VITE_OSM_TILE_URL` only when using an alternative tile service; comply with its key restrictions and usage terms. The default OpenStreetMap tile servers are best-effort with no SLA and require visible attribution; do not bulk-download tiles. Configure `GEOCODER_BASE_URL` on the backend to use a self-hosted Photon instance for higher traffic. Browser GPS requires HTTPS in production; localhost is supported for development.
