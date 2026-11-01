/**
 * Where to send a user after the Auth0 callback. The SDK only checks that the
 * login `returnTo` is same-origin and then keeps its path, so a path such as
 * `//other.example/x` reaches the callback intact — and `new URL()` resolves
 * that as a protocol-relative URL on another host. Anything that does not land
 * back on `baseUrl`'s origin falls back to its root.
 */
export function sameOriginRedirectUrl({
  returnTo,
  baseUrl,
}: {
  returnTo: string | undefined;
  baseUrl: string;
}): URL {
  const root = new URL("/", baseUrl);
  if (!returnTo) return root;
  try {
    const target = new URL(returnTo, baseUrl);
    return target.origin === root.origin ? target : root;
  } catch {
    return root;
  }
}
