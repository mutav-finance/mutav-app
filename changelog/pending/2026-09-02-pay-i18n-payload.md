---
branch: fix/pay-i18n-payload
category: fix
summary: "pay's message catalog drops the twelve orphaned agency namespaces (commission, delinquencies, contracts, nav/chart/metrics/dataTable, userMenu, paymentList, onboarding), and BOTH of pay's NextIntlClientProvider call sites now pass explicit messages — `[locale]/layout.tsx` a four-namespace pick from `src/i18n/client-namespaces.ts`, `global-not-found.tsx` an empty object — so the public payment origin stops serializing agency product copy into every page's HTML, the root 404 included"
sync_actions: []
---
