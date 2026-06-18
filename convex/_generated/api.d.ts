/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agencies_adminUseCases from "../agencies/adminUseCases.js";
import type * as agencies_domain from "../agencies/domain.js";
import type * as agencies_migrations from "../agencies/migrations.js";
import type * as agencies_useCases from "../agencies/useCases.js";
import type * as audit_actions from "../audit/actions.js";
import type * as audit_anchor from "../audit/anchor.js";
import type * as audit_domain from "../audit/domain.js";
import type * as audit_merkle from "../audit/merkle.js";
import type * as audit_useCases from "../audit/useCases.js";
import type * as contracts_actions from "../contracts/actions.js";
import type * as contracts_aggregate from "../contracts/aggregate.js";
import type * as contracts_aggregateWrites from "../contracts/aggregateWrites.js";
import type * as contracts_backfill from "../contracts/backfill.js";
import type * as contracts_domain from "../contracts/domain.js";
import type * as contracts_mutations from "../contracts/mutations.js";
import type * as contracts_useCases from "../contracts/useCases.js";
import type * as creditAnalysis_actions from "../creditAnalysis/actions.js";
import type * as creditAnalysis_domain from "../creditAnalysis/domain.js";
import type * as creditAnalysis_providers_bigdatacorp from "../creditAnalysis/providers/bigdatacorp.js";
import type * as creditAnalysis_providers_cpfcnpj from "../creditAnalysis/providers/cpfcnpj.js";
import type * as creditAnalysis_providers_mock from "../creditAnalysis/providers/mock.js";
import type * as creditAnalysis_registry from "../creditAnalysis/registry.js";
import type * as creditAnalysis_useCases from "../creditAnalysis/useCases.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as invoices_actions from "../invoices/actions.js";
import type * as invoices_domain from "../invoices/domain.js";
import type * as invoices_lib_muxedAddress from "../invoices/lib/muxedAddress.js";
import type * as invoices_lib_muxedId from "../invoices/lib/muxedId.js";
import type * as invoices_mutations from "../invoices/mutations.js";
import type * as invoices_useCases from "../invoices/useCases.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_auth0Mgmt from "../lib/auth0Mgmt.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_pii from "../lib/pii.js";
import type * as lib_result from "../lib/result.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_stellarSigner from "../lib/stellarSigner.js";
import type * as lib_storage from "../lib/storage.js";
import type * as lib_testFixtures from "../lib/testFixtures.js";
import type * as migrations from "../migrations.js";
import type * as payments_domain from "../payments/domain.js";
import type * as payments_settlement from "../payments/settlement.js";
import type * as payments_useCases from "../payments/useCases.js";
import type * as payments_providers_accountDomain from "../payments/providers/accountDomain.js";
import type * as payments_providers_accountUseCases from "../payments/providers/accountUseCases.js";
import type * as payments_providers_actions from "../payments/providers/actions.js";
import type * as payments_providers_bankAccountDomain from "../payments/providers/bankAccountDomain.js";
import type * as payments_providers_bankAccountUseCases from "../payments/providers/bankAccountUseCases.js";
import type * as payments_providers_domain from "../payments/providers/domain.js";
import type * as payments_providers_orderDomain from "../payments/providers/orderDomain.js";
import type * as payments_providers_orderUseCases from "../payments/providers/orderUseCases.js";
import type * as payments_providers_useCases from "../payments/providers/useCases.js";
import type * as payments_providers_webhookUseCases from "../payments/providers/webhookUseCases.js";
import type * as reserve_actions from "../reserve/actions.js";
import type * as reserve_domain from "../reserve/domain.js";
import type * as reserve_useCases from "../reserve/useCases.js";
import type * as seed from "../seed.js";
import type * as smoke_auth0Mgmt from "../smoke/auth0Mgmt.js";
import type * as transparency_domain from "../transparency/domain.js";
import type * as transparency_useCases from "../transparency/useCases.js";
import type * as users_domain from "../users/domain.js";
import type * as users_useCases from "../users/useCases.js";
import type * as waitlist_actions from "../waitlist/actions.js";
import type * as waitlist_domain from "../waitlist/domain.js";
import type * as waitlist_useCases from "../waitlist/useCases.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agencies/adminUseCases": typeof agencies_adminUseCases;
  "agencies/domain": typeof agencies_domain;
  "agencies/migrations": typeof agencies_migrations;
  "agencies/useCases": typeof agencies_useCases;
  "audit/actions": typeof audit_actions;
  "audit/anchor": typeof audit_anchor;
  "audit/domain": typeof audit_domain;
  "audit/merkle": typeof audit_merkle;
  "audit/useCases": typeof audit_useCases;
  "contracts/actions": typeof contracts_actions;
  "contracts/aggregate": typeof contracts_aggregate;
  "contracts/aggregateWrites": typeof contracts_aggregateWrites;
  "contracts/backfill": typeof contracts_backfill;
  "contracts/domain": typeof contracts_domain;
  "contracts/mutations": typeof contracts_mutations;
  "contracts/useCases": typeof contracts_useCases;
  "creditAnalysis/actions": typeof creditAnalysis_actions;
  "creditAnalysis/domain": typeof creditAnalysis_domain;
  "creditAnalysis/providers/bigdatacorp": typeof creditAnalysis_providers_bigdatacorp;
  "creditAnalysis/providers/cpfcnpj": typeof creditAnalysis_providers_cpfcnpj;
  "creditAnalysis/providers/mock": typeof creditAnalysis_providers_mock;
  "creditAnalysis/registry": typeof creditAnalysis_registry;
  "creditAnalysis/useCases": typeof creditAnalysis_useCases;
  crons: typeof crons;
  http: typeof http;
  "invoices/actions": typeof invoices_actions;
  "invoices/domain": typeof invoices_domain;
  "invoices/lib/muxedAddress": typeof invoices_lib_muxedAddress;
  "invoices/lib/muxedId": typeof invoices_lib_muxedId;
  "invoices/mutations": typeof invoices_mutations;
  "invoices/useCases": typeof invoices_useCases;
  "lib/auth": typeof lib_auth;
  "lib/auth0Mgmt": typeof lib_auth0Mgmt;
  "lib/env": typeof lib_env;
  "lib/pii": typeof lib_pii;
  "lib/result": typeof lib_result;
  "lib/secrets": typeof lib_secrets;
  "lib/stellarSigner": typeof lib_stellarSigner;
  "lib/storage": typeof lib_storage;
  "lib/testFixtures": typeof lib_testFixtures;
  migrations: typeof migrations;
  "payments/domain": typeof payments_domain;
  "payments/settlement": typeof payments_settlement;
  "payments/useCases": typeof payments_useCases;
  "payments/providers/accountDomain": typeof payments_providers_accountDomain;
  "payments/providers/accountUseCases": typeof payments_providers_accountUseCases;
  "payments/providers/actions": typeof payments_providers_actions;
  "payments/providers/bankAccountDomain": typeof payments_providers_bankAccountDomain;
  "payments/providers/bankAccountUseCases": typeof payments_providers_bankAccountUseCases;
  "payments/providers/domain": typeof payments_providers_domain;
  "payments/providers/orderDomain": typeof payments_providers_orderDomain;
  "payments/providers/orderUseCases": typeof payments_providers_orderUseCases;
  "payments/providers/useCases": typeof payments_providers_useCases;
  "payments/providers/webhookUseCases": typeof payments_providers_webhookUseCases;
  "reserve/actions": typeof reserve_actions;
  "reserve/domain": typeof reserve_domain;
  "reserve/useCases": typeof reserve_useCases;
  seed: typeof seed;
  "smoke/auth0Mgmt": typeof smoke_auth0Mgmt;
  "transparency/domain": typeof transparency_domain;
  "transparency/useCases": typeof transparency_useCases;
  "users/domain": typeof users_domain;
  "users/useCases": typeof users_useCases;
  "waitlist/actions": typeof waitlist_actions;
  "waitlist/domain": typeof waitlist_domain;
  "waitlist/useCases": typeof waitlist_useCases;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  contractsByStatus: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"contractsByStatus">;
  contractsByStatusPlatform: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"contractsByStatusPlatform">;
  ativoInsuredCentsPlatform: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"ativoInsuredCentsPlatform">;
};
