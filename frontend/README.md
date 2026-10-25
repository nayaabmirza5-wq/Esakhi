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

The frontend has customer flows for OTP sign-in, product discovery, cart, checkout, profile, saved address, order history, and optional order push notifications. The protected workspace includes dashboard, product management, inventory, orders, customers, settings, and non-mutating API checks. The endpoint map in the root `plan.md` tracks backend routes.

Admin accounts must be provisioned securely through the backend's `npm run admin:create` command; customer self-registration never grants admin access. Admins can upload product images from the product editor. Gift-card and promotional-banner/carousel management are not available in the backend and are not presented as active frontend features.

The supplied emblem is stored at `public/images/esakhi-emblem.png`. Admins can upload up to 10 JPEG, PNG, or WebP product images (5 MB each) from the product editor. The backend stores those images in its `uploads/product-images/` directory, which must use persistent storage for deployed environments. Real product and maker photographs, business-approved copy, service area, and payment configuration should be supplied by the business; the interface does not invent catalogue or operational records.

To enable web push, configure the `VITE_FIREBASE_*` public web-app values and `VITE_FIREBASE_VAPID_KEY` in `.env`; configure `FIREBASE_SERVICE_ACCOUNT_JSON` only on the backend. Push delivery is optional and requires user permission and a supported browser secure context (localhost or HTTPS).
