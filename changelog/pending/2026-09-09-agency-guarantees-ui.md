---
branch: refactor/agency-guarantees-ui
category: refactor
summary: "the agency app moves onto the guarantees domain: `(app)/contracts/**` becomes `(app)/guarantees/**` behind a permanent redirect, the `contractDetails`/`contractList`/`contractNew` namespaces become `guaranteeDetails`/`guaranteeList`/`guaranteeNew` keyed on the seven English states in both catalogs, the detail page splits the old rental card into a lease card (property + rent, from the joined lease) and a terms card (product, plan, fees, ceiling and exit-cost cap, from the immutable snapshot), the list gains a tab per state via `getGuaranteeTabCounts` and both dashboards break counts down per state so `in_arrears` reads on its own, the wizard prices its preview against `products.getDefaultPublic` instead of the seed constant, the Brazil money and date formatters move from each app's `lib/*/format.ts` to `@mutav/i18n/brazil`, and the temporary `api.contracts.*` facade plus the legacy `countAtivos`/`countPendentes`/`ContractAggregates` transparency aliases are deleted"
sync_actions: []
---
