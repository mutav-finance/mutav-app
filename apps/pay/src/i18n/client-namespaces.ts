/**
 * Namespaces that cross to the client bundle.
 *
 * Everything else in the catalog stays server-side: without this pick,
 * next-intl inherits the whole catalog from `./request.ts` and serializes it
 * into every page's HTML — including the unauthenticated 404 at the root of
 * this public origin.
 *
 * Derived from every component pay renders that calls `useTranslations`:
 *   - `checkout`       checkout-pix-view, checkout-anchor-test-view
 *   - `paymentFlow`    copyable-{value,address,sep7-link},
 *                      payment-summary-header, horizon-payment-poller,
 *                      payment-address-paid-receipt
 *   - `paymentDetails` payment-summary-header (`paymentDetails.state`)
 *   - `common`         carried conservatively; pay reads `common.a11y` only
 *                      from a server component today and hands it down as a
 *                      prop, so this entry is one string of slack, not a
 *                      dependency. Dropping it is a payload nit, not a fix.
 *
 * `meta` is metadata-only and `notFound` renders in server components, so
 * neither needs to reach the client.
 *
 * Nothing here is type-checked — a namespace a client component needs but
 * this list omits surfaces as a raw key in the browser, never at build time.
 * tests/i18n-namespace-contract.test.ts test D is what makes that fail in CI:
 * it holds this list against every `useTranslations` call in apps/pay/src and
 * the workspace modules pay renders.
 */
export const CLIENT_NAMESPACES = ["common", "checkout", "paymentDetails", "paymentFlow"] as const;
