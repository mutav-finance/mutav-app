---
pr: unmerged
branch: refactor/auth0-shared-session
category: refactor
summary: agency and admin share one Auth0 module (callback, proxy, convex-token route, ID-token refresh); backend failures no longer route to login; first login links by verified email only
sync_actions:
  - kind: install
    detail: "bun install"
  - kind: env
    detail: "Optional: AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS on the agency and admin Next.js apps (default 600); not a Convex var"
  - kind: manual
    detail: "Auth0 tenant: enable refresh-token rotation + reuse detection with ~30 s overlap on the app; see docs/auth0.md"
---
