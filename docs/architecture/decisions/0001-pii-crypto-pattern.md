# ADR 0001 — PII crypto pattern: two-key envelope + hash sidecar

**Status:** Accepted (2026-05-19) · **Phase:** P0 of [LGPD compliance milestone](../../../README.md) · **Tracking:** [#82](https://github.com/mutav-finance/mutav-app/issues/82), [#88](https://github.com/mutav-finance/mutav-app/issues/88)

## Context

Brazil's LGPD Art. 18 (IX) right-to-erasure is in force, and Art. 46 requires pseudonymization of stored personal data. Mutav stores plaintext CPF, CNPJ, full names, emails, phones, birth dates, bank account numbers, and account holder names across `agencies`, `users`, `contracts.tenant`, and `agencyBankAccounts`. Several of those fields are indexed (`agencies.by_cpf`, `agencies.by_cnpj`, `users.by_email`, `contracts.by_agency_tenant_cpf`) — equality lookups that the production code depends on.

Retrofitting field-level encryption after launch is one of the most expensive migrations possible because every read path needs a decrypt boundary and every indexed lookup needs a replacement equality key. Doing it pre-customer is cheap; doing it post-customer is not.

The existing crypto primitive (`convex/lib/secrets.ts`) encrypts the per-agency Stellar treasury secret using AES-256-GCM under a single key. That pattern is sound for opaque secrets but breaks down for PII for two reasons:

1. It lives in a `"use node"` module and cannot be called from V8 queries/mutations. PII reads happen everywhere; we need primitives the default Convex runtime can use.
2. A single key gives us encryption but no equality lookup. CPF's 11-digit keyspace (~10¹¹) is small enough to enumerate from a plain SHA-256 in seconds; we need a peppered hash whose pepper compromise alone leaks nothing decryptable.

## Decision

Every PII field is stored as `{ fieldHash, fieldEncrypted }`, where:

- `fieldHash`: HMAC-SHA256 of the plaintext under a dedicated `PII_HMAC_KEY`. Indexed when equality lookups are needed.
- `fieldEncrypted`: AES-256-GCM envelope `{ ciphertext, iv, authTag }` (all base64) under a dedicated `PII_ENCRYPTION_KEY`. Decrypted only at presentation/export boundaries; reads are audit-logged (P5).

The two keys MUST be distinct secrets. Implementation: `convex/lib/pii.ts` exposes `encryptPii`, `decryptPii`, `hashPii`, the `EncryptedEnvelope` type, and `encryptedEnvelopeValidator`. All three primitives are V8-compatible (WebCrypto), so queries and mutations can compute hashes inline.

## Why two keys, not one

The threat model treats key compromise as a real event (cloud key-manager misconfiguration, an exfiltrated env var in a CI log, a single-engineer mistake). With one key:

- Compromise leaks plaintext for every encrypted field AND lets the attacker compute hashes to find rows by document.

With two keys:

- Compromise of `PII_HMAC_KEY` alone lets the attacker brute-force the hash (CPF enumeration becomes possible) but reveals no ciphertext.
- Compromise of `PII_ENCRYPTION_KEY` alone lets the attacker decrypt rows they already exfiltrated but provides no way to look up a person's row by CPF.
- Compromise of both is required to enumerate and decrypt — strictly harder than either alone.

The cost is two env vars and a marginally more complex rotation story. Both are acceptable.

## Why WebCrypto (V8), not `node:crypto`

The existing `convex/lib/secrets.ts` is annotated `"use node"` because it uses `createCipheriv`. That confines callers to actions and a few wrappers — fine for the Stellar secret path because the secret is only consumed inside SEP-10 signing actions.

PII is different. Every public query that returns a user's email or every mutation that inserts a CPF needs to either encrypt at write time or compute a hash sidecar. Both happen inside the default V8 runtime. Forcing them through an action boundary would:

- Double the latency of every PII-touching request.
- Fragment the auth model: V8 queries pick up identity through the wrappers (`convex/lib/auth.ts`); actions need the identity passed explicitly. We do not want PII reads to live behind action boundaries with looser auth semantics.
- Bloat the bundle in unrelated modules.

WebCrypto (`globalThis.crypto.subtle`) is available in the default Convex runtime and exposes the same AES-GCM + HMAC-SHA256 primitives. `convex/lib/pii.ts` uses it directly; `convex/lib/secrets.ts` stays Node-only for the Stellar path. The two coexist — they protect different assets.

## Envelope shape

```ts
type EncryptedEnvelope = {
  ciphertext: string; // base64
  iv: string; // base64, 12 bytes (96 bits — GCM standard)
  authTag: string; // base64, 16 bytes (GCM auth tag)
};
```

WebCrypto's `crypto.subtle.encrypt` returns ciphertext || authTag concatenated. `encryptPii` splits the trailing 16 bytes back out so the on-disk shape matches the Node primitive — one contract across the codebase. `decryptPii` re-joins them before calling `crypto.subtle.decrypt`. Storage cost is identical to the Node envelope.

A fresh 12-byte IV is generated per call via `crypto.getRandomValues`. GCM's uniqueness invariant holds with overwhelming probability at our throughput; IV reuse under the same key catastrophically breaks confidentiality, so the implementation does not expose an IV-as-input variant.

## First consumer: `claimedDocuments`

P0 introduces the table `claimedDocuments({ documentHash, agencyId, claimedAt })` indexed by `documentHash`. The plaintext CPF/CNPJ never lives in this row — only the HMAC. The table simultaneously:

1. Demonstrates the hash sidecar pattern that P2/P3 apply to existing tables.
2. Closes a known race in `submitOnboarding` (two concurrent writers could both reach SUBMITTED with the same CPF because their patches targeted distinct rows). The claim row gives Convex's single-doc OCC something to serialize on; the loser's retry observes the existing claim and returns `ALREADY_REGISTERED`.

The lifecycle is intentionally minimal: insert on submit, delete on `reviewOnboarding(rejected)` (CPF freed), retain on `reviewOnboarding(approved)` (CPF now permanently bound to an active agency). Erasure (P6) extends this — `eraseUser` will also delete the claim rows of erased agencies.

## Rotation

`PII_ENCRYPTION_KEY` can be rotated with a re-encrypt migration: read each envelope, decrypt under the old key, re-encrypt under the new. Storage layout is unchanged; only the cipher key changes.

`PII_HMAC_KEY` rotation is destructive — it invalidates every existing `fieldHash` and so every index built on one. A rotation requires a re-hash migration plus index rebuilds. Treat the HMAC key as long-lived; rotate only on confirmed compromise.

Both keys are env-derived for the dev/preview path. Production rotates to a managed secret (KMS/HSM/Vault) — same migration story as Stellar key per `.claude/notes/deferred-conventions.md`.

## Consequences

**Now (P0):**

- `convex/lib/pii.ts` exports the four primitives. Tests cover roundtrip, tamper detection, HMAC determinism, key separation.
- `convex/lib/env.ts` gains `getPiiEncryptionKey()` and `getPiiHmacKey()` (lazy, mirroring the Stellar key pattern).
- `claimedDocuments` table is the first hash-only consumer; race in `submitOnboarding` closes.

**Next (P2/P3):**

- `agencies` and `users` PII columns migrate to `{fieldHash, fieldEncrypted}`. The `by_cpf`/`by_cnpj`/`by_email` indexes get renamed to `by_*Hash`. All read paths add a decrypt step at the presentation boundary.
- `contracts.tenant` and `agencyBankAccounts` follow the same pattern.

**Later (P5/P6/P7):**

- Decrypts at presentation are audit-logged with a `purpose` tag (P5).
- `eraseUser` workflow erases envelopes + hashes, keeping tombstones for CVM record-keeping (P6).
- DSR surfaces use the same primitives in reverse: re-encrypt an export bundle under a per-request key shared with the data subject (P7).

## Alternatives considered

- **Application-level Convex Crypto add-on.** Convex has no first-party PII encryption helper; bringing in a third-party component would lock us into their key model and audit surface. We need two distinct keys, which is easier to reason about as plain env vars + WebCrypto.
- **Tokenization service (e.g. Skyflow, Very Good Security).** Defers the encryption-at-rest problem to a vendor at the cost of a hard external dependency on every read path — every `useQuery` over a PII field becomes a vendor round-trip. Cost and latency don't fit a real-time dashboard.
- **Field-level encryption in the database.** Convex does not offer transparent column encryption. Doing it at the storage layer would require a custom storage adapter and is outside what the platform supports today.
- **One key for both encrypt and hash.** Simpler operationally but collapses two distinct threat models (key-leak-only vs. data-leak-only) into one. The marginal cost of a second env var is too small to justify the lost defense-in-depth.

## References

- Master tracking: [`#82`](https://github.com/mutav-finance/mutav-app/issues/82)
- Phase 0 issue: [`#88`](https://github.com/mutav-finance/mutav-app/issues/88)
- Regulatory floor: [`../regulatory.md`](../regulatory.md) — LGPD § "Architectural constraints"
- Existing Node envelope: [`../../../convex/lib/secrets.ts`](../../../convex/lib/secrets.ts)
- V8 primitives: [`../../../convex/lib/pii.ts`](../../../convex/lib/pii.ts)
- Convention skill update: [`.claude/skills/convex-document-types/SKILL.md`](../../../.claude/skills/convex-document-types/SKILL.md) — § "PII fields: hash + envelope"
