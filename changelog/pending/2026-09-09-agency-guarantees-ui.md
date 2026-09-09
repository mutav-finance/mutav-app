---
branch: refactor/agency-guarantees-ui
category: refactor
summary: "agency UI moves onto the guarantees domain: routes `(app)/contracts/** → guarantees/**` with a permanent redirect, `contractDetails/contractList/contractNew` i18n namespaces renamed and keyed on the 7 English states, the detail page splits the old rental card into a lease card (property + rent, from the joined lease) and a terms card (product, plan, fees, ceiling and exit-cost cap, from the immutable snapshot), the list carries a tab per state with `getGuaranteeTabCounts`, both dashboards show a per-state breakdown so `in_arrears` is its own figure, the wizard prices its preview against the default product fetched through `products.getDefaultPublic` instead of the seed constant, the user-facing copy in both catalogs follows the namespaces onto the guarantee noun (nav, list, wizard, detail, chart, commission, invoice and transparency labels), the Brazil money/date formatters move from each app's `lib/*/format.ts` to `@mutav/i18n/brazil`, and the `api.contracts.*` facade is deleted"
sync_actions: []
---
