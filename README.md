# Company Access Code

The app presents a Company Access Code screen and then opens the existing Dashboard. The code is validated only by backend middleware and is never embedded in frontend code. Configure `COMPANY_ACCESS_CODE` (a randomly generated value of at least 12 characters) and `SESSION_SECRET` (at least 32 random characters) as server environment variables. Never use `VITE_` prefixes for secrets. Store both values in your hosting provider's secret manager.

A successful request receives an eight-hour signed session in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production). Protected workspace APIs require that cookie. Access-code attempts are limited to five per IP per 15 minutes; authenticated API traffic is limited to 120 requests per IP per minute. The current rate-limit counters are process-local; for multiple server instances or durable limits, use a shared rate-limit store or edge/WAF before deployment.

Set `NODE_ENV=production` and serve over HTTPS so the session cookie is Secure. Keep `SESSION_SECRET` stable across restarts; rotating it invalidates existing sessions and signed file links. Rotate `COMPANY_ACCESS_CODE` by updating the server secret and restarting/redeploying.

Keep the existing PostgreSQL connection variables (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`) on the server only. This implementation requires no schema migration and does not change or delete database records or uploaded files.

Company name/logo settings are read by the application to render the code screen, and `/api/health` is a public status-only endpoint. Workspace data, write operations, and uploads remain behind the access-code session. File URLs are time-limited HMAC-signed capabilities; treat them as sensitive. The legacy Firebase Admin bearer-token file-download fallback is retained for compatibility; it only verifies a signed Firebase ID token and does not provide a login UI.

Run `bun run build`, `bun run lint`, and `bun run test` before deployment. Ensure your deployment injects the required secrets and database variables; never commit production values.
