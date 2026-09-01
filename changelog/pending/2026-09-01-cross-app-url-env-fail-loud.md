---
branch: fix/cross-app-url-env-fail-loud
category: fix
summary: "cross-app URL getters throw instead of falling back to localhost when NODE_ENV=production; NEXT_PUBLIC_ADMIN_URL was unset on mutav-app, which sent staff to http://localhost:3003 after login"
sync_actions:
  - kind: env
    detail: "Set `NEXT_PUBLIC_ADMIN_URL=https://admin.mutav.finance` on the `mutav-app` Vercel project (Production + Preview) BEFORE merging — the guard now fails the build when it is unset."
  - kind: env
    detail: "Set `NEXT_PUBLIC_APP_URL` and `APP_BASE_URL` on `mutav-app-pay` (https://pay.mutav.finance) and `mutav-app-fund` — both projects carry only CONVEX vars today, so both were already resolving to localhost in production."
  - kind: env
    detail: "Preview scope is empty on all four Vercel projects; every preview deploy runs on localhost fallbacks. Mirror the Production values into Preview."
  - kind: manual
    detail: "Local dev needs no action — the localhost port fallbacks still apply whenever NODE_ENV is not production. `.env.example` now documents the full per-project matrix."
---
