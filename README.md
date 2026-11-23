# Work Organizer access

The app presents a Company Access Code screen. Configure `COMPANY_ACCESS_CODE` and `SESSION_SECRET` as server environment variables. Use a randomly generated company code with at least 12 characters and a random session secret of at least 32 characters. Never add either value to frontend variables (including `VITE_` variables), source control, or client-visible configuration. Keep secrets in your hosting provider's secret/environment-variable manager.

A successful code check creates an eight-hour, signed, HttpOnly, SameSite=Strict session cookie (Secure in production). Protected API endpoints require that cookie. Access-code attempts are rate limited to five per IP per 15 minutes; authenticated API calls are limited to 120 per IP per minute. Restarting the process invalidates sessions only if the session secret changes.

The existing PostgreSQL connection remains server-side and unchanged. Keep `SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, and `SQL_DB_NAME` configured only on the server. No database migrations or data changes are required.

Set `NODE_ENV=production` in production and serve the app over HTTPS. The `SESSION_SECRET` must be stable across server restarts and deployments. `COMPANY_ACCESS_CODE` is a shared credential: distribute it only to trusted company users and rotate it by updating the server environment and restarting/redeploying the app.

File URLs are signed and expire after five minutes. Firebase Admin remains referenced by the legacy file-download bearer-token fallback in `server.ts`; it should not be removed until that endpoint is deliberately migrated and verified.
