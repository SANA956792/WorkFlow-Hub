The application starts on the Dashboard with no login or sign-in interface. The Employees, Tasks, Posters, Reels, and Calendar sections remain available through the existing navigation.

Database access remains on the existing server-side PostgreSQL connection. SQL credentials must only be configured as server environment variables and must never be exposed to frontend code. Workspace API routes are deny-by-default and require `WORKFLOW_ALLOWED_IPS`, a comma-separated list of exact approved client IP addresses. Do not use forwarded IP headers as access control unless a trusted reverse proxy is separately configured to overwrite them securely.

Set a stable `SESSION_SECRET` (at least 16 characters) in production so signed file URLs remain consistent across server restarts. No database migrations or data changes are required for these application changes.
