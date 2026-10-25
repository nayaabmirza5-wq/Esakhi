# eSakhi

## Run the application locally

Requirements: Node.js 24, npm, and a configured MongoDB replica set.

Install each app's dependencies once:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
```

Configure `backend/.env` using [`backend/.env.example`](backend/.env.example). The backend needs valid MongoDB and JWT settings before it can start.

From the repository root, run both apps with one command:

```powershell
npm run dev
```

Open the local or network URL printed by Vite. Keep this terminal open while using the app; press Ctrl+C to stop both servers.

The frontend uses the Vite development proxy for API requests, so local access through `localhost` or a LAN address does not require adding that address to the backend CORS allowlist. Leave `VITE_API_BASE_URL` empty when using the proxy. For direct frontend-to-backend calls in a deployment, set `CLIENT_ORIGINS` to the exact HTTPS frontend origin.

## Other commands

```powershell
npm run build
npm run test
npm run typecheck
```
