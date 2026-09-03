---
branch: test/i18n-orphan-namespaces
category: test
summary: 'the conventions job now fails on i18n drift in pay — every top-level key in apps/pay/messages/*.json must be reached by a `useTranslations("ns.sub")` or `getTranslations({ namespace })` call in the app or the workspace modules it imports (transitively, so `paymentFlow.shell` in @mutav/ui/public/public-footer still counts), every referenced namespace must exist in the catalog, every namespace a client component translates must be in the provider pick (now apps/pay/src/i18n/client-namespaces.ts), and every NextIntlClientProvider must pass `messages` explicitly, which is what stops a call site silently re-inheriting the whole catalog through next-intl''s getMessages() default [#308]'
sync_actions: []
---
