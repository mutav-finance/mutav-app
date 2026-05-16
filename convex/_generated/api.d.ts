/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agencies_domain from "../agencies/domain.js";
import type * as agencies_useCases from "../agencies/useCases.js";
import type * as anchors_actions from "../anchors/actions.js";
import type * as anchors_domain from "../anchors/domain.js";
import type * as anchors_useCases from "../anchors/useCases.js";
import type * as anchors_webhook from "../anchors/webhook.js";
import type * as contracts_aggregate from "../contracts/aggregate.js";
import type * as contracts_backfill from "../contracts/backfill.js";
import type * as contracts_domain from "../contracts/domain.js";
import type * as contracts_mutations from "../contracts/mutations.js";
import type * as contracts_useCases from "../contracts/useCases.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_env from "../lib/env.js";
import type * as payments_actions from "../payments/actions.js";
import type * as payments_domain from "../payments/domain.js";
import type * as payments_lib_muxedAddress from "../payments/lib/muxedAddress.js";
import type * as payments_lib_muxedId from "../payments/lib/muxedId.js";
import type * as payments_mutations from "../payments/mutations.js";
import type * as payments_useCases from "../payments/useCases.js";
import type * as seed from "../seed.js";
import type * as users_domain from "../users/domain.js";
import type * as users_useCases from "../users/useCases.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "agencies/domain": typeof agencies_domain;
  "agencies/useCases": typeof agencies_useCases;
  "anchors/actions": typeof anchors_actions;
  "anchors/domain": typeof anchors_domain;
  "anchors/useCases": typeof anchors_useCases;
  "anchors/webhook": typeof anchors_webhook;
  "contracts/aggregate": typeof contracts_aggregate;
  "contracts/backfill": typeof contracts_backfill;
  "contracts/domain": typeof contracts_domain;
  "contracts/mutations": typeof contracts_mutations;
  "contracts/useCases": typeof contracts_useCases;
  crons: typeof crons;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/env": typeof lib_env;
  "payments/actions": typeof payments_actions;
  "payments/domain": typeof payments_domain;
  "payments/lib/muxedAddress": typeof payments_lib_muxedAddress;
  "payments/lib/muxedId": typeof payments_lib_muxedId;
  "payments/mutations": typeof payments_mutations;
  "payments/useCases": typeof payments_useCases;
  seed: typeof seed;
  "users/domain": typeof users_domain;
  "users/useCases": typeof users_useCases;
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
  contractsByStatus: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"contractsByStatus">;
};
