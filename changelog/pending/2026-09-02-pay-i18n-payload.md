---
branch: fix/pay-i18n-payload
category: fix
summary: "pay's message catalog drops the twelve orphaned agency namespaces (commission, delinquencies, contracts, nav/chart/metrics/dataTable, userMenu, paymentList, onboarding) and `[locale]/layout.tsx` now hands NextIntlClientProvider an explicit four-namespace pick, so the public payment origin stops serializing agency product copy into every page's HTML — including the unauthenticated root 404"
sync_actions: []
---
