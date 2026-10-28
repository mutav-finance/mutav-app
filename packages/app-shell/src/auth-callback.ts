import type { OnCallbackHook } from "@auth0/nextjs-auth0/types";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { NextResponse } from "next/server";
import { sameOriginRedirectUrl } from "./auth-redirect";
import { errorCode, errorName } from "./error-fields";

const CALLBACK_FAILED = "callback_failed";

export type ProvisionMutation = FunctionReference<"mutation", "public", Record<string, never>>;

export interface ProvisioningClient {
  setAuth(token: string): void;
  mutation(mutation: ProvisionMutation, args: Record<string, never>): Promise<unknown>;
}

function createHttpClient(convexUrl: string): ProvisioningClient {
  return new ConvexHttpClient(convexUrl);
}

/**
 * The Auth0 `onCallback` hook both apps share. Errors go to `/auth/logout`, not
 * `/auth/login`: a deterministic failure (bad state, callback URL mismatch)
 * would re-enter login and loop. Only the error's name and code are logged or
 * put in the URL, because SDK messages and causes can echo request detail.
 *
 * Provisioning the Convex `users` row fails open on purpose: authorization is
 * enforced by the Convex wrappers and the staff gate on every request, and the
 * client retries provisioning when `getMe` returns null.
 */
export function createOnCallback({
  getAppBaseUrl,
  getConvexUrl,
  provisionMutation,
  createConvexClient = createHttpClient,
}: {
  getAppBaseUrl: () => string;
  getConvexUrl: () => string | null | undefined;
  provisionMutation: ProvisionMutation;
  createConvexClient?: (convexUrl: string) => ProvisioningClient;
}): OnCallbackHook {
  return async function onCallback(error, context, session) {
    const baseUrl = getAppBaseUrl();

    if (error) {
      const code = errorCode(error);
      console.error("[auth0.onCallback] error:", { name: errorName(error), code });
      return NextResponse.redirect(
        new URL(`/auth/logout?error=${encodeURIComponent(code ?? CALLBACK_FAILED)}`, baseUrl),
      );
    }

    const idToken = session?.tokenSet.idToken;
    if (idToken) {
      try {
        const convexUrl = getConvexUrl();
        if (convexUrl) {
          const convex = createConvexClient(convexUrl);
          convex.setAuth(idToken);
          await convex.mutation(provisionMutation, {});
        }
      } catch (provisioningError) {
        console.error("[auth0.onCallback] Convex provisioning failed:", {
          name: errorName(provisioningError),
        });
      }
    }

    return NextResponse.redirect(sameOriginRedirectUrl({ returnTo: context.returnTo, baseUrl }));
  };
}
